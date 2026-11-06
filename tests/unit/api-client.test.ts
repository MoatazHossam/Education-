import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, get, post, request } from '../../public/js/api.js';

// The browser's API client (public/js/api.js). When the server gives no answer, the page must explain it in
// the reader's language: the browser's own error is English whatever the page's language ("Failed to fetch"
// in Chrome, "NetworkError when attempting to fetch resource." in Firefox, "Load failed" in Safari).
const respond = (status: number, body: string, type = 'application/json') => new Response(status === 204 ? null : body, { status, headers: { 'content-type': type } });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the browser API client', () => {
  it('turns no answer at all into NETWORK_ERROR (status 0), from API calls and from downloads', async () => {
    for (const browserText of ['Failed to fetch', 'NetworkError when attempting to fetch resource.', 'Load failed']) {
      vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError(browserText); }));
      const fromApi = await post('/api/auth/login', { email: 'a@b.c', password: 'x' }).catch((e: unknown) => e);
      expect(fromApi).toBeInstanceOf(ApiError);
      expect(fromApi).toMatchObject({ status: 0, code: 'NETWORK_ERROR' });
      expect((fromApi as ApiError).message).not.toContain(browserText);
      // The answer saves of an online test are tried again while `!err.status`: a lost connection still is.
      expect(!(fromApi as ApiError).status).toBe(true);
      const fromDownload = await request('/api/orgs/x/scopes/y/export?format=csv', { credentials: 'same-origin' }).catch((e: unknown) => e);
      expect(fromDownload).toMatchObject({ status: 0, code: 'NETWORK_ERROR' });
      expect((fromDownload as Error).cause).toBeInstanceOf(TypeError);
    }
  });

  it('lets a cancelled request stay a cancellation', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new DOMException('The operation was aborted.', 'AbortError'); }));
    await expect(request('/api/auth/me')).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('names a gateway error without the app’s JSON SERVER_UNAVAILABLE, and keeps the app’s own codes', async () => {
    for (const status of [502, 503, 504]) {
      vi.stubGlobal('fetch', vi.fn(async () => respond(status, '<h1>Bad Gateway</h1>', 'text/html')));
      await expect(get('/api/auth/me')).rejects.toMatchObject({ status, code: 'SERVER_UNAVAILABLE' });
    }
    // The app's own 5xx answers carry their code (AI_UNAVAILABLE, BILLING_DISABLED, PAYMENT_PROVIDER_ERROR...).
    vi.stubGlobal('fetch', vi.fn(async () => respond(503, JSON.stringify({ error: { code: 'AI_BUSY', message: 'The AI service is busy. Try again in a minute.' } }))));
    await expect(get('/api/x')).rejects.toMatchObject({ status: 503, code: 'AI_BUSY', message: 'The AI service is busy. Try again in a minute.' });
    vi.stubGlobal('fetch', vi.fn(async () => respond(500, 'oops', 'text/plain')));
    await expect(get('/api/x')).rejects.toMatchObject({ status: 500, code: 'HTTP_500' });
  });

  it('every page reaches the server through the client, so none shows the browser’s own text', () => {
    const root = new URL('../../public/js/', import.meta.url).pathname;
    const files = readdirSync(root, { recursive: true, encoding: 'utf8' }).filter((f) => f.endsWith('.js'));
    const direct = files.filter((f) => /\bfetch\(/.test(readFileSync(join(root, f), 'utf8')));
    expect(direct).toEqual(['api.js']); // inside request()
  });

  it('has both messages in English and Arabic', () => {
    const src = readFileSync(new URL('../../public/js/i18n.js', import.meta.url), 'utf8');
    const body = src.slice(0, src.indexOf('const DICTS'));
    const { en, ar } = new Function(`${body}; return { en, ar };`)() as Record<'en' | 'ar', Record<string, string>>;
    for (const key of ['err.NETWORK_ERROR', 'err.SERVER_UNAVAILABLE']) {
      expect(en[key], key).toBeTruthy();
      expect(ar[key], key).toMatch(/[؀-ۿ]/);
    }
  });
});
