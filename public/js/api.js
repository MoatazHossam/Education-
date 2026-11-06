// JSON API client. Sends the per-session CSRF token on every state-changing
// request and retries once if the token went stale (e.g. after a session rotation).
let csrfToken = null;
let onUnauthorized = () => {};

export function setCsrf(token) { csrfToken = token; }
export function setUnauthorizedHandler(fn) { onUnauthorized = fn; }

// The proxy in front of the app (Caddy) answers these, without the app's JSON, when no app instance answers.
const GATEWAY = new Set([502, 503, 504]);

export class ApiError extends Error {
  constructor(status, body) {
    super(body?.error?.message || `Request failed (${status})`);
    this.status = status;
    this.code = body?.error?.code || (GATEWAY.has(status) ? 'SERVER_UNAVAILABLE' : 'HTTP_' + status);
    this.details = body?.error?.details;
  }
}

/**
 * fetch, with "no answer at all" (no connection, the server stopped, the connection cut) as an ApiError
 * of status 0 and code NETWORK_ERROR, so the page can say so in the reader's language rather than show
 * the browser's own English text ("Failed to fetch", "NetworkError when attempting to fetch resource.").
 * Code that tries again on a lost connection checks `!err.status`, which status 0 keeps true.
 */
export async function request(path, init) {
  try {
    return await fetch(path, init);
  } catch (err) {
    if (err?.name === 'AbortError') throw err;
    const e = new ApiError(0, { error: { code: 'NETWORK_ERROR' } });
    e.cause = err;
    throw e;
  }
}

async function raw(method, path, body, { keepalive = false } = {}) {
  const headers = { accept: 'application/json' };
  // A File is sent as its raw bytes (uploads); anything else as JSON.
  const isFile = typeof globalThis.File === 'function' && body instanceof globalThis.File;
  if (isFile) {
    headers['content-type'] = 'application/octet-stream';
    headers['x-file-name'] = encodeURIComponent(body.name);
  } else if (body !== undefined) headers['content-type'] = 'application/json';
  if (method !== 'GET' && csrfToken) headers['x-csrf-token'] = csrfToken;
  const res = await request(path, { method, headers, credentials: 'same-origin', keepalive, body: isFile ? body : body !== undefined ? JSON.stringify(body) : undefined });
  let data = null;
  if (res.status !== 204) { try { data = await res.json(); } catch { data = null; } }
  return { res, data };
}

/** `keepalive` lets the browser finish the request after the page is gone (bodies up to 64 KB). */
export async function api(method, path, body, opts) {
  let { res, data } = await raw(method, path, body, opts);
  if (res.status === 403 && data?.error?.code === 'CSRF_TOKEN_INVALID') {
    const me = await raw('GET', '/api/auth/me');
    if (me.res.ok && me.data?.csrfToken) {
      csrfToken = me.data.csrfToken;
      ({ res, data } = await raw(method, path, body, opts));
    }
  }
  if (res.status === 401 && !path.startsWith('/api/auth/')) onUnauthorized();
  if (!res.ok) throw new ApiError(res.status, data);
  return data;
}

export const get = (p) => api('GET', p);
export const post = (p, b = {}, opts) => api('POST', p, b, opts);
export const patch = (p, b = {}) => api('PATCH', p, b);
export const del = (p, b) => api('DELETE', p, b);
export const put = (p, b = {}) => api('PUT', p, b);
/** Uploads a photo or PDF (raw bytes); the server checks the type from the file itself. */
export const upload = (p, file) => api('POST', p, file);
