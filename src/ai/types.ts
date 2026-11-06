/**
 * AI provider abstraction (docs/AI_LAYER.md). A provider turns one request
 * (instructions, the task, optionally a JSON schema for the reply) into one
 * reply. Everything else — which schools may use AI, monthly limits, the usage
 * log, validation of the reply — lives in src/ai/service.ts and is the same for
 * every provider, so a provider can be swapped by configuration alone.
 */
export const AI_PROVIDERS = ['gemini', 'anthropic', 'openai'] as const;
export type AiProviderName = (typeof AI_PROVIDERS)[number];

export interface AiRequest {
  /** Who the assistant is and the rules it follows. */
  system: string;
  /** The task and its material. Never students' data (docs/AI_LAYER.md §3). */
  prompt: string;
  /**
   * When set, the reply must be one JSON value matching this schema, in the
   * portable form of src/ai/schema.ts (every provider accepts it).
   */
  jsonSchema?: Record<string, unknown>;
  maxOutputTokens: number;
}

export interface AiReply {
  text: string;
  /** stop: complete; length: cut at maxOutputTokens; refused: the provider's safety rules declined. */
  finish: 'stop' | 'length' | 'refused' | 'other';
  /** The model that answered, as the provider reports it (a fallback model may differ from the configured one). */
  model: string;
  inputTokens: number | null;
  outputTokens: number | null;
}

export interface AiProvider {
  readonly name: AiProviderName;
  /** The configured model. */
  readonly model: string;
  generate(req: AiRequest): Promise<AiReply>;
}

export type AiErrorKind = 'auth' | 'rate_limited' | 'unavailable' | 'timeout' | 'bad_request' | 'other';

/** Retries after the first attempt of one provider call, when the server's settings do not say (AI_MAX_RETRIES). */
export const DEFAULT_MAX_RETRIES = 1;
/**
 * Wait allowed before each retry. The SDKs' own backoff is 0.5–8 s; the Anthropic and OpenAI SDKs
 * also wait as long as a provider's retry-after header asks, up to 60 s (Gemini's does not).
 */
export const RETRY_WAIT_MS = 10_000;

/**
 * Deadline of one provider call, retries included (production finding A-4): each attempt may take
 * the whole per-attempt timeout, plus RETRY_WAIT_MS before each retry. A call still running then is
 * cancelled and reported as a timeout, however long the provider asked to wait.
 */
export function callDeadlineMs(timeoutMs: number, maxRetries: number, retryWaitMs = RETRY_WAIT_MS): number {
  return (1 + maxRetries) * timeoutMs + maxRetries * retryWaitMs;
}

/** Settings shared by the provider adapters. */
export interface ProviderConfig {
  apiKey: string;
  model: string;
  /** The provider's API endpoint; the SDK's own when unset. */
  apiBase?: string;
  /** Per attempt. */
  timeoutMs: number;
  /** Retries after the first attempt (DEFAULT_MAX_RETRIES when unset). */
  maxRetries?: number;
  /** Wait allowed before each retry (RETRY_WAIT_MS when unset; shorter in tests). */
  retryWaitMs?: number;
}

/** The provider refused or failed the request. The message is for server logs only. */
export class AiProviderError extends Error {
  constructor(
    message: string,
    public readonly kind: AiErrorKind,
    public readonly status?: number,
  ) {
    super(message);
    this.name = 'AiProviderError';
  }
}

/** Maps an HTTP status from a provider to an error kind. */
export function errorKindForStatus(status: number | undefined): AiErrorKind {
  if (status === 401 || status === 403) return 'auth';
  if (status === 429) return 'rate_limited';
  if (status === 408) return 'timeout';
  if (status !== undefined && status >= 500) return 'unavailable';
  if (status !== undefined && status >= 400) return 'bad_request';
  return 'other';
}
