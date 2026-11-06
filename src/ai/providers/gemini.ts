import { ApiError, FinishReason, GoogleGenAI } from '@google/genai';
import { AiProviderError, callDeadlineMs, DEFAULT_MAX_RETRIES, errorKindForStatus, type AiProvider, type AiReply, type AiRequest, type ProviderConfig } from '../types.js';

/** apiBase: the Gemini API endpoint. */
export type GeminiConfig = ProviderConfig;

// Finish reasons that mean the provider's safety or policy rules stopped the reply.
const REFUSED = new Set<string>([FinishReason.SAFETY, FinishReason.RECITATION, FinishReason.BLOCKLIST, FinishReason.PROHIBITED_CONTENT, FinishReason.SPII]);

/** Google Gemini API (generateContent) through Google's SDK. */
export class GeminiProvider implements AiProvider {
  readonly name = 'gemini' as const;
  readonly model: string;
  private readonly client: GoogleGenAI;
  private readonly deadlineMs: number;

  constructor(config: GeminiConfig) {
    this.model = config.model;
    const maxRetries = config.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.deadlineMs = callDeadlineMs(config.timeoutMs, maxRetries, config.retryWaitMs);
    this.client = new GoogleGenAI({
      apiKey: config.apiKey,
      // Per-attempt timeout; retries timeouts, 408, 429 and 5xx after a short backoff (not retry-after).
      httpOptions: { timeout: config.timeoutMs, retryOptions: { attempts: maxRetries + 1 }, ...(config.apiBase ? { baseUrl: config.apiBase } : {}) },
    });
  }

  async generate(req: AiRequest): Promise<AiReply> {
    // The whole call, retries included.
    const deadline = AbortSignal.timeout(this.deadlineMs);
    let res;
    try {
      res = await settleByDeadline(
        this.client.models.generateContent({
          model: this.model,
          contents: [{ role: 'user', parts: [{ text: req.prompt }] }],
          config: {
            systemInstruction: req.system,
            maxOutputTokens: req.maxOutputTokens,
            abortSignal: deadline,
            ...(req.jsonSchema ? { responseMimeType: 'application/json', responseJsonSchema: req.jsonSchema } : {}),
          },
        }),
        deadline,
      );
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

/**
 * The SDK cancels a request in flight when the signal aborts, but not its wait before a retry (1–2 s
 * before the first): settle at the deadline anyway. The retry it then starts carries the aborted
 * signal and sends nothing.
 */
function settleByDeadline<T>(call: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    signal.addEventListener('abort', onAbort, { once: true });
    call.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
  });
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
