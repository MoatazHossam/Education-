import { ApiError, FinishReason, GoogleGenAI } from '@google/genai';
import { AiProviderError, errorKindForStatus, type AiProvider, type AiReply, type AiRequest } from '../types.js';

export interface GeminiConfig {
  apiKey: string;
  model: string;
  /** Gemini API endpoint; the SDK's own when unset. */
  apiBase?: string;
  timeoutMs: number;
  /** Retries after the first attempt (default 2). */
  maxRetries?: number;
}

// Finish reasons that mean the provider's safety or policy rules stopped the reply.
const REFUSED = new Set<string>([FinishReason.SAFETY, FinishReason.RECITATION, FinishReason.BLOCKLIST, FinishReason.PROHIBITED_CONTENT, FinishReason.SPII]);

/** Google Gemini API (generateContent) through Google's SDK. */
export class GeminiProvider implements AiProvider {
  readonly name = 'gemini' as const;
  readonly model: string;
  private readonly client: GoogleGenAI;

  constructor(config: GeminiConfig) {
    this.model = config.model;
    this.client = new GoogleGenAI({
      apiKey: config.apiKey,
      // Per-attempt timeout; retries on 408, 429 and 5xx with backoff.
      httpOptions: { timeout: config.timeoutMs, retryOptions: { attempts: (config.maxRetries ?? 2) + 1 }, ...(config.apiBase ? { baseUrl: config.apiBase } : {}) },
    });
  }

  async generate(req: AiRequest): Promise<AiReply> {
    let res;
    try {
      res = await this.client.models.generateContent({
        model: this.model,
        contents: [{ role: 'user', parts: [{ text: req.prompt }] }],
        config: {
          systemInstruction: req.system,
          maxOutputTokens: req.maxOutputTokens,
          ...(req.jsonSchema ? { responseMimeType: 'application/json', responseJsonSchema: req.jsonSchema } : {}),
        },
      });
    } catch (err) {
      throw toProviderError(err);
    }
    const usage = res.usageMetadata;
    // Thinking tokens are billed as output.
    const output = usage?.candidatesTokenCount === undefined && usage?.thoughtsTokenCount === undefined ? null : (usage.candidatesTokenCount ?? 0) + (usage.thoughtsTokenCount ?? 0);
    const reply = { model: res.modelVersion ?? this.model, inputTokens: usage?.promptTokenCount ?? null, outputTokens: output };
    if (res.promptFeedback?.blockReason) return { ...reply, text: '', finish: 'refused' };
    const reason = res.candidates?.[0]?.finishReason;
    const finish = reason === FinishReason.STOP ? 'stop' : reason === FinishReason.MAX_TOKENS ? 'length' : reason && REFUSED.has(reason) ? 'refused' : 'other';
    return { ...reply, text: res.text ?? '', finish };
  }
}

function toProviderError(err: unknown): AiProviderError {
  if (err instanceof ApiError) {
    // An invalid key is a 400 with reason API_KEY_INVALID, not a 401.
    const kind = err.status === 400 && err.message.includes('API_KEY_INVALID') ? 'auth' : errorKindForStatus(err.status);
    return new AiProviderError(`Gemini API ${err.status}: ${err.message}`, kind, err.status);
  }
  if (err instanceof Error && (err.name === 'AbortError' || err.name === 'TimeoutError')) return new AiProviderError('Gemini API: request timed out', 'timeout');
  return new AiProviderError(`Gemini API: ${err instanceof Error ? err.message : String(err)}`, 'unavailable');
}
