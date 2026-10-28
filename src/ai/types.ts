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
