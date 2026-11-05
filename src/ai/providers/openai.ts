import OpenAI from 'openai';
import { AiProviderError, callDeadlineMs, DEFAULT_MAX_RETRIES, errorKindForStatus, type AiProvider, type AiReply, type AiRequest, type ProviderConfig } from '../types.js';

/** apiBase: the Chat Completions endpoint, including /v1. */
export type OpenAiConfig = ProviderConfig;

/** OpenAI Chat Completions through OpenAI's SDK (or a service that implements the same API). */
export class OpenAiProvider implements AiProvider {
  readonly name = 'openai' as const;
  readonly model: string;
  private readonly client: OpenAI;
  private readonly deadlineMs: number;

  constructor(config: OpenAiConfig) {
    this.model = config.model;
    const maxRetries = config.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.deadlineMs = callDeadlineMs(config.timeoutMs, maxRetries, config.retryWaitMs);
    // Retries timeouts, 408, 409, 429, 5xx and connection errors, honouring retry-after up to 60 s.
    this.client = new OpenAI({ apiKey: config.apiKey, timeout: config.timeoutMs, maxRetries, ...(config.apiBase ? { baseURL: config.apiBase } : {}) });
  }

  async generate(req: AiRequest): Promise<AiReply> {
    let res;
    try {
      res = await this.client.chat.completions.create(
        {
          model: this.model,
          messages: [
            { role: 'system', content: req.system },
            { role: 'user', content: req.prompt },
          ],
          // Counts reasoning tokens too, on the models that have them.
          max_completion_tokens: req.maxOutputTokens,
          ...(req.jsonSchema ? { response_format: { type: 'json_schema' as const, json_schema: { name: 'reply', schema: req.jsonSchema, strict: true } } } : {}),
        },
        // The whole call, retries included.
        { signal: AbortSignal.timeout(this.deadlineMs) },
      );
    } catch (err) {
      throw toProviderError(err);
    }
    const choice = res.choices[0];
    const reply = { model: res.model, inputTokens: res.usage?.prompt_tokens ?? null, outputTokens: res.usage?.completion_tokens ?? null };
    if (!choice) return { ...reply, text: '', finish: 'other' };
    if (choice.message.refusal || choice.finish_reason === 'content_filter') return { ...reply, text: '', finish: 'refused' };
    const finish = choice.finish_reason === 'stop' ? 'stop' : choice.finish_reason === 'length' ? 'length' : 'other';
    return { ...reply, text: choice.message.content ?? '', finish };
  }
}

function toProviderError(err: unknown): AiProviderError {
  // The call's deadline passed (the only abort signal it is given).
  if (err instanceof OpenAI.APIUserAbortError) return new AiProviderError('OpenAI API: no answer before the deadline', 'timeout');
  if (err instanceof OpenAI.APIConnectionTimeoutError) return new AiProviderError('OpenAI API: request timed out', 'timeout');
  if (err instanceof OpenAI.APIConnectionError) return new AiProviderError(`OpenAI API: ${err.message}`, 'unavailable');
  if (err instanceof OpenAI.APIError) return new AiProviderError(`OpenAI API ${err.status ?? ''}: ${err.message}`, errorKindForStatus(err.status), err.status);
  return new AiProviderError(`OpenAI API: ${err instanceof Error ? err.message : String(err)}`, 'other');
}
