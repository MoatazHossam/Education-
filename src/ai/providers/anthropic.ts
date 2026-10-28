import Anthropic from '@anthropic-ai/sdk';
import { AiProviderError, errorKindForStatus, type AiProvider, type AiReply, type AiRequest } from '../types.js';

export interface AnthropicConfig {
  apiKey: string;
  model: string;
  /** Messages API endpoint; the SDK's own when unset. */
  apiBase?: string;
  timeoutMs: number;
  /** Retries after the first attempt (default 2). */
  maxRetries?: number;
}

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

  constructor(config: AnthropicConfig) {
    this.model = config.model;
    // Retries 408, 409, 429, 5xx and connection errors twice, honouring retry-after.
    this.client = new Anthropic({ apiKey: config.apiKey, timeout: config.timeoutMs, maxRetries: config.maxRetries ?? 2, ...(config.apiBase ? { baseURL: config.apiBase } : {}) });
  }

  async generate(req: AiRequest): Promise<AiReply> {
    const params = {
      model: this.model,
      max_tokens: req.maxOutputTokens,
      system: req.system,
      messages: [{ role: 'user' as const, content: req.prompt }],
      ...(req.jsonSchema ? { output_config: { format: { type: 'json_schema' as const, schema: req.jsonSchema } } } : {}),
    };
    let res;
    try {
      res = SERVER_FALLBACK_MODELS.has(this.model)
        ? await this.client.beta.messages.create({ ...params, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' })
        : await this.client.messages.create(params);
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
  if (err instanceof Anthropic.APIConnectionTimeoutError) return new AiProviderError('Anthropic API: request timed out', 'timeout');
  if (err instanceof Anthropic.APIConnectionError) return new AiProviderError(`Anthropic API: ${err.message}`, 'unavailable');
  if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) return new AiProviderError(`Anthropic API ${err.status}: ${err.message}`, 'auth', err.status);
  if (err instanceof Anthropic.RateLimitError) return new AiProviderError(`Anthropic API 429: ${err.message}`, 'rate_limited', 429);
  // 529 (overloaded) and other 5xx.
  if (err instanceof Anthropic.InternalServerError) return new AiProviderError(`Anthropic API ${err.status}: ${err.message}`, 'unavailable', err.status);
  if (err instanceof Anthropic.APIError) return new AiProviderError(`Anthropic API ${err.status ?? ''}: ${err.message}`, errorKindForStatus(err.status), err.status);
  return new AiProviderError(`Anthropic API: ${err instanceof Error ? err.message : String(err)}`, 'other');
}
