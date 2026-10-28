import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * Local stand-in for the three AI providers' HTTP APIs, written from their API
 * references: Gemini `models/{model}:generateContent` (x-goog-api-key), Anthropic
 * Messages `/v1/messages` (x-api-key, anthropic-version), OpenAI Chat
 * Completions `/v1/chat/completions` (Bearer). It checks the key, records each
 * request, and answers with the providers' documented response and error
 * shapes. Passing against it does not replace a run against the provider
 * itself (`npm run ai:check` with a real key).
 */

export type SimProvider = 'gemini' | 'anthropic' | 'openai';

export interface RecordedAiRequest {
  provider: SimProvider;
  path: string;
  headers: IncomingMessage['headers'];
  body: Record<string, unknown>;
}

/** What the next request to a provider gets. Unscripted requests get an `ok` reply with `defaultText`. */
export type SimReply =
  | { kind: 'ok'; text: string; inputTokens?: number; outputTokens?: number; model?: string }
  | { kind: 'length'; text: string }
  | { kind: 'refusal' }
  | { kind: 'error'; status: number; retryAfterMs?: number }
  | { kind: 'hang' };

export const DEFAULT_REPLY = '{"ok":true}';

export class AiSimulator {
  readonly requests: RecordedAiRequest[] = [];
  private server: Server | null = null;
  private readonly queue: Record<SimProvider, SimReply[]> = { gemini: [], anthropic: [], openai: [] };
  url = '';
  /** Text of the reply to unscripted requests. */
  defaultText = DEFAULT_REPLY;
  /** For unscripted requests: a reply chosen from the request, or undefined for `defaultText`. */
  respond: ((provider: SimProvider, body: Record<string, unknown>) => string | undefined) | null = null;

  constructor(readonly apiKey: string) {}

  /** Replies, in order, to the next requests to `provider`. */
  script(provider: SimProvider, ...replies: SimReply[]): void {
    this.queue[provider].push(...replies);
  }

  reset(): void {
    this.requests.length = 0;
    this.defaultText = DEFAULT_REPLY;
    this.respond = null;
    for (const q of Object.values(this.queue)) q.length = 0;
  }

  /** Base URL to give each provider's SDK. */
  base(provider: SimProvider): string {
    return provider === 'openai' ? `${this.url}/v1` : this.url;
  }

  async start(port = 0): Promise<void> {
    this.server = createServer((req, res) => void this.handle(req, res));
    await new Promise<void>((resolve) => this.server!.listen(port, '127.0.0.1', resolve));
    this.url = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
  }

  async stop(): Promise<void> {
    this.server?.closeAllConnections();
    await new Promise<void>((resolve) => (this.server ? this.server.close(() => resolve()) : resolve()));
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const path = (req.url ?? '').split('?')[0]!;
    let body: Record<string, unknown> = {};
    try {
      body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') as Record<string, unknown>;
    } catch {
      return send(res, 400, { error: 'invalid json' });
    }
    const gemini = /^\/v1beta\/models\/([^/:]+):generateContent$/.exec(path);
    const provider: SimProvider | null = gemini ? 'gemini' : path === '/v1/messages' ? 'anthropic' : path === '/v1/chat/completions' ? 'openai' : null;
    if (!provider || req.method !== 'POST') return send(res, 404, { error: 'not found' });
    this.requests.push({ provider, path, headers: req.headers, body });

    if (!this.authorized(provider, req)) return this.error(res, provider, 401);
    const reply = this.queue[provider].shift() ?? { kind: 'ok', text: this.respond?.(provider, body) ?? this.defaultText };
    if (reply.kind === 'hang') return; // never answers: the client's timeout must fire
    if (reply.kind === 'error') return this.error(res, provider, reply.status, reply.retryAfterMs);
    const model = (provider === 'gemini' ? gemini![1] : String(body.model)) ?? 'unknown';
    if (provider === 'gemini') return send(res, 200, geminiReply(reply, model));
    if (provider === 'anthropic') return send(res, 200, anthropicReply(reply, model));
    return send(res, 200, openaiReply(reply, model));
  }

  private authorized(provider: SimProvider, req: IncomingMessage): boolean {
    if (provider === 'gemini') return req.headers['x-goog-api-key'] === this.apiKey;
    if (provider === 'anthropic') return req.headers['x-api-key'] === this.apiKey && typeof req.headers['anthropic-version'] === 'string';
    return req.headers.authorization === `Bearer ${this.apiKey}`;
  }

  private error(res: ServerResponse, provider: SimProvider, status: number, retryAfterMs?: number): void {
    const headers: Record<string, string> = retryAfterMs !== undefined ? { 'retry-after-ms': String(retryAfterMs), 'retry-after': String(Math.ceil(retryAfterMs / 1000)) } : {};
    if (provider === 'gemini') {
      // Google APIs: an invalid key is a 400 INVALID_ARGUMENT with reason API_KEY_INVALID.
      const s = status === 401 ? 400 : status;
      const reason = status === 401 ? [{ '@type': 'type.googleapis.com/google.rpc.ErrorInfo', reason: 'API_KEY_INVALID', domain: 'googleapis.com' }] : [];
      const statusName = { 400: 'INVALID_ARGUMENT', 403: 'PERMISSION_DENIED', 429: 'RESOURCE_EXHAUSTED', 500: 'INTERNAL', 503: 'UNAVAILABLE' }[s] ?? 'UNKNOWN';
      return send(res, s, { error: { code: s, message: status === 401 ? 'API key not valid. Please pass a valid API key.' : 'simulated error', status: statusName, details: reason } }, headers);
    }
    if (provider === 'anthropic') {
      const type = { 400: 'invalid_request_error', 401: 'authentication_error', 403: 'permission_error', 429: 'rate_limit_error', 500: 'api_error', 529: 'overloaded_error' }[status] ?? 'api_error';
      return send(res, status, { type: 'error', error: { type, message: 'simulated error' } }, headers);
    }
    const type = { 401: 'invalid_request_error', 429: 'rate_limit_exceeded' }[status] ?? 'server_error';
    send(res, status, { error: { message: 'simulated error', type, param: null, code: status === 401 ? 'invalid_api_key' : null } }, headers);
  }
}

function send(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  res.writeHead(status, { 'content-type': 'application/json', ...headers });
  res.end(JSON.stringify(body));
}

function geminiReply(r: Exclude<SimReply, { kind: 'error' | 'hang' }>, model: string) {
  const usage = { promptTokenCount: r.kind === 'ok' ? (r.inputTokens ?? 120) : 120, candidatesTokenCount: r.kind === 'ok' ? (r.outputTokens ?? 30) : 30, thoughtsTokenCount: 10 };
  if (r.kind === 'refusal') return { candidates: [{ content: { role: 'model', parts: [] }, finishReason: 'SAFETY', index: 0 }], usageMetadata: usage, modelVersion: model };
  const finishReason = r.kind === 'length' ? 'MAX_TOKENS' : 'STOP';
  return {
    candidates: [{ content: { role: 'model', parts: [{ text: r.text }] }, finishReason, index: 0 }],
    usageMetadata: { ...usage, totalTokenCount: usage.promptTokenCount + usage.candidatesTokenCount + usage.thoughtsTokenCount },
    modelVersion: r.kind === 'ok' && r.model ? r.model : model,
  };
}

function anthropicReply(r: Exclude<SimReply, { kind: 'error' | 'hang' }>, model: string) {
  const usage = { input_tokens: r.kind === 'ok' ? (r.inputTokens ?? 120) : 120, output_tokens: r.kind === 'ok' ? (r.outputTokens ?? 40) : 40 };
  const base = { id: 'msg_sim', type: 'message', role: 'assistant', model: r.kind === 'ok' && r.model ? r.model : model, stop_sequence: null, usage };
  if (r.kind === 'refusal') return { ...base, content: [], stop_reason: 'refusal', stop_details: { type: 'refusal', category: null, explanation: null } };
  return {
    ...base,
    // Thinking blocks come first on models that think; their text is not part of the answer.
    content: [{ type: 'thinking', thinking: '', signature: 'sim' }, { type: 'text', text: r.text }],
    stop_reason: r.kind === 'length' ? 'max_tokens' : 'end_turn',
  };
}

function openaiReply(r: Exclude<SimReply, { kind: 'error' | 'hang' }>, model: string) {
  const usage = { prompt_tokens: r.kind === 'ok' ? (r.inputTokens ?? 120) : 120, completion_tokens: r.kind === 'ok' ? (r.outputTokens ?? 35) : 35, total_tokens: 155 };
  const message = r.kind === 'refusal' ? { role: 'assistant', content: null, refusal: 'I cannot help with that.' } : { role: 'assistant', content: r.text, refusal: null };
  return {
    id: 'chatcmpl-sim',
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: r.kind === 'ok' && r.model ? r.model : model,
    choices: [{ index: 0, message, finish_reason: r.kind === 'length' ? 'length' : 'stop', logprobs: null }],
    usage,
  };
}
