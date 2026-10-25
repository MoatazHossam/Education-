import type { FastifyBaseLogger } from 'fastify';
import type { PaymentProvider } from '../billing/providers/types.js';
import type { AppConfig } from '../config.js';
import type { Database } from '../db/index.js';
import type { Session, User } from '../db/types.js';
import type { ServerErrorCounter } from '../ops/alerts.js';

export interface AppContext {
  config: AppConfig;
  db: Database;
  log: FastifyBaseLogger;
  payments: PaymentProvider | null;
}

export type AuthState =
  | { kind: 'session'; user: User; session: Session }
  | { kind: 'api_key'; orgId: string; keyId: string; keyName: string }
  | null;

declare module 'fastify' {
  interface FastifyRequest {
    auth: AuthState;
  }
  interface FastifyInstance {
    routeList: { method: string; url: string }[];
    /** Set on shutdown: /readyz reports "draining" so the load balancer stops routing here. */
    lifecycle: { draining: boolean };
    /** 5xx responses on this instance, read by the alert checks. */
    serverErrors: ServerErrorCounter;
  }
}
