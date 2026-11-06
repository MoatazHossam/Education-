import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createAiProvider } from '../../src/ai/providers/index.js';
import { InvalidReplyError, parseJsonReply, portableSchema } from '../../src/ai/schema.js';
import { aiDayKey, aiWorstCaseMs, estimateTokens } from '../../src/ai/service.js';
import { callDeadlineMs, errorKindForStatus } from '../../src/ai/types.js';
import { loadConfig } from '../../src/config.js';
import { TEST_ENV } from '../helpers/env.js';

const Questions = z.object({
  questions: z
    .array(
      z.object({
        kind: z.enum(['mcq', 'short']),
        text: z.string().min(3).max(500),
        choices: z.array(z.string()).min(2).max(6).nullable(),
        answer: z.number().int().min(0),
      }),
    )
    .min(1)
    .max(20),
});

describe('portable reply schema', () => {
  it('keeps types and structure, closes every object, and drops the limits some providers reject', () => {
    expect(portableSchema(Questions)).toEqual({
      type: 'object',
      properties: {
        questions: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              kind: { type: 'string', enum: ['mcq', 'short'] },
              text: { type: 'string' },
              choices: { anyOf: [{ type: 'array', items: { type: 'string' } }, { type: 'null' }] },
              answer: { type: 'integer' },
            },
            required: ['kind', 'text', 'choices', 'answer'],
            additionalProperties: false,
          },
        },
      },
      required: ['questions'],
      additionalProperties: false,
    });
  });

  it('refuses optional fields: every provider must be able to require them all', () => {
    expect(() => portableSchema(z.object({ a: z.string(), b: z.string().optional() }))).toThrow(/\$ has optional properties \(b\)/);
    expect(() => portableSchema(z.object({ list: z.array(z.object({ c: z.number().optional() })) }))).toThrow(/\$\.list\[\] has optional properties \(c\)/);
  });
});

describe('JSON reply', () => {
  const reply = '{"questions":[{"kind":"short","text":"Name a planet.","choices":null,"answer":0}]}';

  it('parses a reply and checks it against the full schema, limits included', () => {
    expect(parseJsonReply(reply, Questions).questions[0]!.text).toBe('Name a planet.');
    expect(() => parseJsonReply('{"questions":[]}', Questions)).toThrow(InvalidReplyError);
    expect(() => parseJsonReply('{"questions":[{"kind":"short","text":"x","choices":null,"answer":0}]}', Questions)).toThrow(/questions\.0\.text/);
  });

  it('accepts JSON in a Markdown code fence and rejects text that is not JSON', () => {
    expect(parseJsonReply(`\`\`\`json\n${reply}\n\`\`\``, Questions).questions).toHaveLength(1);
    expect(() => parseJsonReply('Here are your questions: …', Questions)).toThrow(/not JSON/);
  });
});

describe('provider errors', () => {
  it('maps HTTP statuses to kinds', () => {
    expect([401, 403, 429, 408, 500, 529, 400, 404, undefined].map(errorKindForStatus)).toEqual(['auth', 'auth', 'rate_limited', 'timeout', 'unavailable', 'unavailable', 'bad_request', 'bad_request', 'other']);
  });
});

describe('AI configuration', () => {
  it('is off unless a provider is chosen, and a provider needs a key and a model', () => {
    expect(createAiProvider(loadConfig(TEST_ENV))).toBeNull();
    expect(() => loadConfig({ ...TEST_ENV, AI_PROVIDER: 'gemini' })).toThrow(/AI_API_KEY is required when AI_PROVIDER=gemini[\s\S]*AI_MODEL is required/);
    expect(() => loadConfig({ ...TEST_ENV, AI_PROVIDER: 'anthropic', AI_API_KEY: 'k-0123456789', AI_MODEL: 'claude opus' })).toThrow(/AI_MODEL must be a model id/);
    for (const name of ['gemini', 'anthropic', 'openai'] as const) {
      const ai = createAiProvider(loadConfig({ ...TEST_ENV, AI_PROVIDER: name, AI_API_KEY: 'k-0123456789', AI_MODEL: 'some-model-1' }));
      expect(ai?.name).toBe(name);
      expect(ai?.model).toBe('some-model-1');
    }
  });

  it('requires https for a replaced endpoint in production', () => {
    const prod = { ...TEST_ENV, NODE_ENV: 'production', BILLING_PROVIDER: 'disabled', EMAIL_TRANSPORT: 'smtp', SMTP_URL: 'smtp://x', APP_URL: 'https://app.example', FILE_SCAN: 'off' };
    const ai = { AI_PROVIDER: 'openai', AI_API_KEY: 'k-0123456789', AI_MODEL: 'gpt-5' };
    expect(() => loadConfig({ ...prod, ...ai, AI_API_BASE: 'http://llm.internal/v1' })).toThrow(/AI_API_BASE must use https in production/);
    expect(loadConfig({ ...prod, ...ai, AI_API_BASE: 'https://llm.example/v1' }).AI_TIMEOUT_MS).toBe(60_000);
  });

  it('waits at most about 4 minutes for the provider by default (finding A-4)', () => {
    const config = loadConfig({ ...TEST_ENV, AI_PROVIDER: 'gemini', AI_API_KEY: 'k-0123456789', AI_MODEL: 'gemini-2.5-pro' });
    expect([config.AI_TIMEOUT_MS, config.AI_MAX_RETRIES]).toEqual([60_000, 1]);
    // One call: two attempts of 60 s and 10 s before the retry. A reply of the wrong shape is asked for once more.
    expect(callDeadlineMs(60_000, 1)).toBe(130_000);
    expect(aiWorstCaseMs(config)).toBe(260_000);
    // Before task 1.6: 120 s and 2 retries.
    expect(aiWorstCaseMs({ AI_TIMEOUT_MS: 120_000, AI_MAX_RETRIES: 2 })).toBe(760_000);
    expect(loadConfig({ ...TEST_ENV, AI_MAX_RETRIES: '0' }).AI_MAX_RETRIES).toBe(0);
    expect(() => loadConfig({ ...TEST_ENV, AI_MAX_RETRIES: '4' })).toThrow(/AI_MAX_RETRIES/);
    expect(() => loadConfig({ ...TEST_ENV, AI_TIMEOUT_MS: '1000' })).toThrow(/AI_TIMEOUT_MS/);
  });
});

describe('AI cost controls', () => {
  it('estimates a request\'s tokens on the high side: half a token per prompt character, plus all the output it may use', () => {
    expect(estimateTokens(0, 1000)).toBe(1000);
    expect(estimateTokens(101, 16_000)).toBe(16_051);
    // An Arabic prompt of 6,000 characters (often around 3,000 tokens) is held at 3,000 plus its output.
    expect(estimateTokens(6000, 4000)).toBe(7000);
  });

  it('counts members\' daily requests by UTC day, like the monthly period', () => {
    expect(aiDayKey(new Date('2026-11-06T23:59:59Z'))).toBe('2026-11-06');
    expect(aiDayKey(new Date('2026-11-07T00:00:00Z'))).toBe('2026-11-07');
  });

  it('caps a member at 50 requests a day unless set otherwise; 0 turns the daily cap off', () => {
    expect(loadConfig(TEST_ENV).AI_USER_DAILY_LIMIT).toBe(50);
    expect(loadConfig({ ...TEST_ENV, AI_USER_DAILY_LIMIT: '0' }).AI_USER_DAILY_LIMIT).toBe(0);
    expect(() => loadConfig({ ...TEST_ENV, AI_USER_DAILY_LIMIT: '-1' })).toThrow(/AI_USER_DAILY_LIMIT/);
  });
});
