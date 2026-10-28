import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { AnthropicProvider } from '../../src/ai/providers/anthropic.js';
import { GeminiProvider } from '../../src/ai/providers/gemini.js';
import { OpenAiProvider } from '../../src/ai/providers/openai.js';
import { portableSchema } from '../../src/ai/schema.js';
import { AiProviderError, type AiProvider } from '../../src/ai/types.js';
import { AiSimulator, DEFAULT_REPLY, type SimProvider } from '../helpers/ai-simulator.js';

// Each adapter against a local simulator of its provider's documented API
// (tests/helpers/ai-simulator.ts): request shape, key header, reply parsing,
// refusals, truncation, error mapping, retries and timeouts.

const KEY = 'sim-key-0123456789';
const sim = new AiSimulator(KEY);
beforeAll(() => sim.start());
afterAll(() => sim.stop());
beforeEach(() => sim.reset());

const MODELS: Record<SimProvider, string> = { gemini: 'gemini-2.5-pro', anthropic: 'claude-opus-5-5', openai: 'gpt-5' };

function provider(name: SimProvider, opts: { key?: string; model?: string; maxRetries?: number; timeoutMs?: number } = {}): AiProvider {
  const config = { apiKey: opts.key ?? KEY, model: opts.model ?? MODELS[name], apiBase: sim.base(name), timeoutMs: opts.timeoutMs ?? 10_000, maxRetries: opts.maxRetries ?? 0 };
  return name === 'gemini' ? new GeminiProvider(config) : name === 'anthropic' ? new AnthropicProvider(config) : new OpenAiProvider(config);
}

const Reply = z.object({ title: z.string().min(1).max(80), items: z.array(z.string()).min(1) });
const REQUEST = { system: 'You write short lists for teachers.', prompt: 'List three revision topics for grade 5 science.', jsonSchema: portableSchema(Reply), maxOutputTokens: 2000 };

async function failure(p: Promise<unknown>): Promise<AiProviderError> {
  const err = await p.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(AiProviderError);
  return err as AiProviderError;
}

describe.each(['gemini', 'anthropic', 'openai'] as const)('%s adapter', (name) => {
  it('sends the instructions, the task and the schema where the API documents them, with the key, and reads the reply', async () => {
    sim.script(name, { kind: 'ok', text: '{"title":"Revision","items":["Plants","Water"]}', inputTokens: 210, outputTokens: 55 });
    const reply = await provider(name).generate(REQUEST);
    expect(reply.text).toBe('{"title":"Revision","items":["Plants","Water"]}');
    expect(reply.finish).toBe('stop');
    expect(reply.model).toBe(MODELS[name]);
    expect(reply.inputTokens).toBe(210);
    expect(reply.outputTokens).toBe(name === 'gemini' ? 65 : 55); // Gemini: answer + thinking tokens

    const [req] = sim.requests;
    const body = req!.body;
    if (name === 'gemini') {
      expect(req!.path).toBe(`/v1beta/models/${MODELS.gemini}:generateContent`);
      expect(body).toMatchObject({
        systemInstruction: { parts: [{ text: REQUEST.system }] },
        contents: [{ role: 'user', parts: [{ text: REQUEST.prompt }] }],
        generationConfig: { maxOutputTokens: 2000, responseMimeType: 'application/json', responseJsonSchema: REQUEST.jsonSchema },
      });
    } else if (name === 'anthropic') {
      expect(body).toMatchObject({ model: MODELS.anthropic, max_tokens: 2000, system: REQUEST.system, messages: [{ role: 'user', content: REQUEST.prompt }] });
      expect(body.output_config).toEqual({ format: { type: 'json_schema', schema: REQUEST.jsonSchema } });
      // Current models reject sampling parameters.
      expect(body).not.toHaveProperty('temperature');
      expect(req!.headers['anthropic-version']).toBeTruthy();
    } else {
      expect(body).toMatchObject({ model: MODELS.openai, max_completion_tokens: 2000, messages: [{ role: 'system', content: REQUEST.system }, { role: 'user', content: REQUEST.prompt }] });
      expect(body.response_format).toEqual({ type: 'json_schema', json_schema: { name: 'reply', schema: REQUEST.jsonSchema, strict: true } });
    }
  });

  it('sends no schema when the reply is free text', async () => {
    await provider(name).generate({ system: 's', prompt: 'p', maxOutputTokens: 500 });
    const body = sim.requests[0]!.body;
    if (name === 'gemini') expect(body.generationConfig).not.toHaveProperty('responseJsonSchema');
    if (name === 'anthropic') expect(body).not.toHaveProperty('output_config');
    if (name === 'openai') expect(body).not.toHaveProperty('response_format');
  });

  it('reports a reply cut at the token limit and a refusal', async () => {
    sim.script(name, { kind: 'length', text: '{"title":"Rev' }, { kind: 'refusal' });
    const cut = await provider(name).generate(REQUEST);
    expect(cut).toMatchObject({ finish: 'length', text: '{"title":"Rev' });
    const refused = await provider(name).generate(REQUEST);
    expect(refused).toMatchObject({ finish: 'refused', text: '' });
  });

  it('maps a rejected key to "auth" without retrying', async () => {
    const err = await failure(provider(name, { key: 'wrong-key-000000', maxRetries: 2 }).generate(REQUEST));
    expect(err.kind).toBe('auth');
    expect(sim.requests).toHaveLength(1);
    expect(err.message).not.toContain(KEY);
  });

  it('maps rate limits, server errors and invalid requests', async () => {
    sim.script(name, { kind: 'error', status: 429 }, { kind: 'error', status: 500 }, { kind: 'error', status: 400 });
    expect((await failure(provider(name).generate(REQUEST))).kind).toBe('rate_limited');
    expect((await failure(provider(name).generate(REQUEST))).kind).toBe('unavailable');
    expect((await failure(provider(name).generate(REQUEST))).kind).toBe('bad_request');
  });

  it('retries a temporary failure and returns the answer', async () => {
    sim.script(name, { kind: 'error', status: 503, retryAfterMs: 10 });
    const reply = await provider(name, { maxRetries: 1 }).generate(REQUEST);
    expect(reply.text).toBe(DEFAULT_REPLY);
    expect(sim.requests).toHaveLength(2);
  });

  it('gives up after the timeout', async () => {
    sim.script(name, { kind: 'hang' });
    const err = await failure(provider(name, { timeoutMs: 300 }).generate(REQUEST));
    expect(err.kind).toBe('timeout');
  });
});

describe('anthropic: server-side fallback', () => {
  it('opts into the default fallback on models whose classifiers can decline', async () => {
    await provider('anthropic', { model: 'claude-opus-5-5' }).generate(REQUEST);
    const req = sim.requests[0]!;
    expect(req.headers['anthropic-beta']).toContain('server-side-fallback-2026-07-01');
    expect(req.body.fallbacks).toBe('default');
  });

  it('reports the model that answered when a fallback ran', async () => {
    sim.script('anthropic', { kind: 'ok', text: DEFAULT_REPLY, model: 'claude-opus-4-8' });
    expect((await provider('anthropic').generate(REQUEST)).model).toBe('claude-opus-4-8');
  });

  it('sends a plain request to other models', async () => {
    await provider('anthropic', { model: 'claude-haiku-5-5' }).generate(REQUEST);
    const req = sim.requests[0]!;
    expect(req.headers['anthropic-beta']).toBeUndefined();
    expect(req.body).not.toHaveProperty('fallbacks');
  });
});
