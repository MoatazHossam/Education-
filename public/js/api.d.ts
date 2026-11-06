// Types for the unit tests (tests/unit/api-client.test.ts); the browser loads api.js as it is.
export class ApiError extends Error {
  constructor(status: number, body: unknown);
  status: number;
  code: string;
  details?: unknown;
}
export function request(path: string, init?: RequestInit): Promise<Response>;
export function setCsrf(token: string | null): void;
export function setUnauthorizedHandler(fn: () => void): void;
export function api(method: string, path: string, body?: unknown, opts?: { keepalive?: boolean }): Promise<unknown>;
export function get(path: string): Promise<unknown>;
export function post(path: string, body?: unknown, opts?: { keepalive?: boolean }): Promise<unknown>;
export function patch(path: string, body?: unknown): Promise<unknown>;
export function del(path: string, body?: unknown): Promise<unknown>;
export function put(path: string, body?: unknown): Promise<unknown>;
export function upload(path: string, file: File): Promise<unknown>;
