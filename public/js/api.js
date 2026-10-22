// JSON API client. Sends the per-session CSRF token on every state-changing
// request and retries once if the token went stale (e.g. after a session rotation).
let csrfToken = null;
let onUnauthorized = () => {};

export function setCsrf(token) { csrfToken = token; }
export function setUnauthorizedHandler(fn) { onUnauthorized = fn; }

export class ApiError extends Error {
  constructor(status, body) {
    super(body?.error?.message || `Request failed (${status})`);
    this.status = status;
    this.code = body?.error?.code || 'HTTP_' + status;
    this.details = body?.error?.details;
  }
}

async function raw(method, path, body) {
  const headers = { accept: 'application/json' };
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (method !== 'GET' && csrfToken) headers['x-csrf-token'] = csrfToken;
  const res = await fetch(path, { method, headers, credentials: 'same-origin', body: body !== undefined ? JSON.stringify(body) : undefined });
  let data = null;
  if (res.status !== 204) { try { data = await res.json(); } catch { data = null; } }
  return { res, data };
}

export async function api(method, path, body) {
  let { res, data } = await raw(method, path, body);
  if (res.status === 403 && data?.error?.code === 'CSRF_TOKEN_INVALID') {
    const me = await raw('GET', '/api/auth/me');
    if (me.res.ok && me.data?.csrfToken) {
      csrfToken = me.data.csrfToken;
      ({ res, data } = await raw(method, path, body));
    }
  }
  if (res.status === 401 && !path.startsWith('/api/auth/')) onUnauthorized();
  if (!res.ok) throw new ApiError(res.status, data);
  return data;
}

export const get = (p) => api('GET', p);
export const post = (p, b = {}) => api('POST', p, b);
export const patch = (p, b = {}) => api('PATCH', p, b);
export const del = (p) => api('DELETE', p);
