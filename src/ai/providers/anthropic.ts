import Anthropic from '@anthropic-ai/sdk';
import { AiProviderError, callDeadlineMs, DEFAULT_MAX_RETRIES, errorKindForStatus, type AiProvider, type AiReply, type AiRequest, type ProviderConfig } from '../types.js';

/** apiBase: the Messages API endpoint. */
export type AnthropicConfig = ProviderConfig;

// Models whose safety classifiers can decline a request: on these the request
// opts into Anthropic's server-side fallback, which re-runs a declined request on
// the model Anthropic recommends for that kind of refusal, in the same call.
const SERVER_FALLBACK_MODELS = new Set(['claude-fable-5-1', 'claude-opus-5-5', 'claude-opus-5', 'claude-sonnet-5-5']);

/**
 * Anthropic Messages API through Anthropic's SDK. No sampling parameters are
 * sent (current models reject them), and thinking is left to the model's
 * default, so the reply carries only the answer.
 */
export class AnthropicProvider implements AiProvider {
  readonly name = 'anthropic' as const;
  readonly model: string;
  private readonly client: Anthropic;
  private readonly deadlineMs: number;

  constructor(config: AnthropicConfig) {
    this.model = config.model;
    const maxRetries = config.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.deadlineMs = callDeadlineMs(config.timeoutMs, maxRetries, config.retryWaitMs);
    // Retries timeouts, 408, 409, 429, 5xx and connection errors, honouring retry-after up to 60 s.
    this.client = new Anthropic({ apiKey: config.apiKey, timeout: config.timeoutMs, maxRetries, ...(config.apiBase ? { baseURL: config.apiBase } : {}) });
  }

  async generate(req: AiRequest): Promise<AiReply> {
    const params = {
      model: this.model,
      max_tokens: req.maxOutputTokens,
      system: req.system,
      messages: [{ role: 'user' as const, content: req.prompt }],
      ...(req.jsonSchema ? { output_config: { format: { type: 'json_schema' as const, schema: req.jsonSchema } } } : {}),
    };
    // The whole call, retries included.
    const options = { signal: AbortSignal.timeout(this.deadlineMs) };
    let res;
    try {
      res = SERVER_FALLBACK_MODELS.has(this.model)
        ? await this.client.beta.messages.create({ ...params, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' }, options)
        : await this.client.messages.create(params, options);
    } catch (err) {
      throw toProviderError(err);
    }
    const reply = { model: res.model, inputTokens: res.usage.input_tokens, outputTokens: res.usage.output_tokens };
    // A refusal can come with partial or no content: check it before reading the text.
    if (res.stop_reason === 'refusal') return { ...reply, text: '', finish: 'refused' };
    const text = res.content.map((b) => (b.type === 'text' ? b.text : '')).join('');
    const finish = res.stop_reason === 'end_turn' || res.stop_reason === 'stop_sequence' ? 'stop' : res.stop_reason === 'max_tokens' ? 'length' : 'other';
    return { ...reply, text, finish };
  }
}

function toProviderError(err: unknown): AiProviderError {
  // The call's deadline passed (the only abort signal it is given).
  if (err instanceof Anthropic.APIUserAbortError) return new AiProviderError('Anthropic API: no answer before the deadline', 'timeout');
  if (err instanceof Anthropic.APIConnectionTimeoutError) return new AiProviderError('Anthropic API: request timed out', 'timeout');
  if (err instanceof Anthropic.APIConnectionError) return new AiProviderError(`Anthropic API: ${err.message}`, 'unavailable');
  if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) return new AiProviderError(`Anthropic API ${err.status}: ${err.message}`, 'auth', err.status);
  if (err instanceof Anthropic.RateLimitError) return new AiProviderError(`Anthropic API 429: ${err.message}`, 'rate_limited', 429);
  // 529 (overloaded) and other 5xx.
  if (err instanceof Anthropic.InternalServerError) return new AiProviderError(`Anthropic API ${err.status}: ${err.message}`, 'unavailable', err.status);
  if (err instanceof Anthropic.APIError) return new AiProviderError(`Anthropic API ${err.status ?? ''}: ${err.message}`, errorKindForStatus(err.status), err.status);
  return new AiProviderError(`Anthropic API: ${err instanceof Error ? err.message : String(err)}`, 'other');
}
