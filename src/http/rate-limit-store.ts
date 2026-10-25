import { sql } from 'kysely';
import type { Database } from '../db/index.js';
import { hmacHex } from '../lib/crypto.js';

type Result = { current: number; ttl: number };
type Done = (error: Error | null, result?: Result) => void;
interface Windows {
  incr(key: string, windowMs: number): Promise<Result>;
  read(key: string): Promise<Result>;
}
interface StoreOptions {
  continueExceeding?: boolean;
  exponentialBackoff?: boolean;
  routeInfo?: { method?: string | string[]; url?: string };
}

/**
 * Fixed-window counters in this process's memory, for the global flood guard:
 * no database work per request, so a flood stays off the shared database.
 * Bounded: when full, the oldest windows are dropped first.
 */
export class MemoryWindows implements Windows {
  private readonly windows = new Map<string, { count: number; resetAt: number }>();

  constructor(private readonly maxKeys = 10_000, private readonly clock = () => Date.now()) {}

  async incr(key: string, windowMs: number): Promise<Result> {
    const now = this.clock();
    let w = this.windows.get(key);
    if (!w || w.resetAt <= now) {
      this.windows.delete(key); // re-inserted last, so insertion order stays oldest-first
      w = { count: 0, resetAt: now + windowMs };
      this.windows.set(key, w);
      if (this.windows.size > this.maxKeys) this.windows.delete(this.windows.keys().next().value!);
    }
    w.count++;
    return { current: w.count, ttl: w.resetAt - now };
  }

  async read(key: string): Promise<Result> {
    const now = this.clock();
    const w = this.windows.get(key);
    return w && w.resetAt > now ? { current: w.count, ttl: w.resetAt - now } : { current: 0, ttl: 0 };
  }
}

const TTL = sql<string>`ceil(extract(epoch FROM expires_at - now()) * 1000)::bigint`;

/**
 * Fixed-window counters in PostgreSQL, shared by every app instance and timed
 * by the database clock; one atomic upsert per request. Keys are HMACs of the
 * namespace (route) and the client key (IP, or IP and email), so the table
 * holds no IP addresses or emails.
 */
export class PostgresWindows implements Windows {
  constructor(private readonly db: Database, private readonly secret: string, private readonly namespace: string) {}

  private keyOf(key: string): string {
    return hmacHex(this.secret, `rate-limit|${this.namespace}|${key}`);
  }

  async incr(key: string, windowMs: number): Promise<Result> {
    const { rows } = await sql<{ count: number; ttl: string }>`
      INSERT INTO rate_limits AS r (key, count, expires_at)
      VALUES (${this.keyOf(key)}, 1, now() + ${windowMs}::float8 * interval '1 millisecond')
      ON CONFLICT (key) DO UPDATE SET
        count = CASE WHEN r.expires_at <= now() THEN 1 ELSE r.count + 1 END,
        expires_at = CASE WHEN r.expires_at <= now() THEN EXCLUDED.expires_at ELSE r.expires_at END
      RETURNING count, ${TTL} AS ttl`.execute(this.db);
    return { current: rows[0]!.count, ttl: Number(rows[0]!.ttl) };
  }

  async read(key: string): Promise<Result> {
    const { rows } = await sql<{ count: number; ttl: string }>`
      SELECT count, ${TTL} AS ttl FROM rate_limits WHERE key = ${this.keyOf(key)} AND expires_at > now()`.execute(this.db);
    return rows[0] ? { current: rows[0].count, ttl: Number(rows[0].ttl) } : { current: 0, ttl: 0 };
  }
}

/**
 * Store for @fastify/rate-limit. The global limit (every API request) is a
 * per-process flood guard kept in memory. Every route with its own limit
 * (login, two-factor codes, password reset, registration, invitations,
 * checkout, the v1 API quota) counts in PostgreSQL, so those limits hold
 * across all app instances and restarts.
 */
export function rateLimitStore(db: Database, secret: string) {
  return class RateLimitStore {
    private readonly windows: Windows;

    constructor(options: StoreOptions = {}, windows?: Windows) {
      // Both options lengthen windows on every request over the limit; not used here, so refused rather than ignored.
      if (options.continueExceeding || options.exponentialBackoff) throw new Error('The rate-limit store supports fixed windows only');
      this.windows = windows ?? new MemoryWindows();
    }

    incr(key: string, done: Done, timeWindow: number): void {
      this.windows.incr(key, timeWindow).then((r) => done(null, r), (err: Error) => done(err));
    }

    /** The current window's count without counting this request (`{ increment: false }`). */
    read(key: string, done: Done): void {
      this.windows.read(key).then((r) => done(null, r), (err: Error) => done(err));
    }

    /**
     * A route with its own limit, counted in PostgreSQL under its own namespace.
     * The plugin passes the route's merged limit options with `routeInfo` (its
     * type declarations say RouteOptions).
     */
    child(routeOptions: object): RateLimitStore {
      const options = routeOptions as StoreOptions;
      const { method = '', url = '' } = options.routeInfo ?? {};
      return new RateLimitStore(options, new PostgresWindows(db, secret, `${([] as string[]).concat(method).join(',')} ${url}`));
    }
  };
}
