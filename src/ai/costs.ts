import { sql, type RawBuilder } from 'kysely';
import type { AppConfig } from '../config.js';
import { withSystemContext, type Database, type Executor } from '../db/index.js';
import { AppError } from '../lib/errors.js';
import { periodKey } from '../lib/time.js';
import type { AiProviderName } from './types.js';

// What AI requests cost, and the platform's monthly spending cap (production findings A-2, A-3;
// docs/AI_LAYER.md §3). Prices come only from ai_model_prices, entered by a platform administrator
// from the provider's price page: nothing here assumes a price. One US dollar per million tokens is
// one millionth of a dollar ("micro-dollar") per token, so a request costs
// input tokens × input price + output tokens × output price micro-dollars, rounded up. The sum is
// exact: PostgreSQL computes it in numeric.

/** 503 while AI requests are refused for the platform's budget, or for a model without a price under a budget. */
export const aiPaused = () => new AppError(503, 'AI_PAUSED', 'AI assistance is paused for now. Try again later.');

/** The first instant of the UTC month `period` (YYYY-MM). */
export const monthStart = (period = periodKey()) => new Date(`${period}-01T00:00:00Z`);

export const usdToMicros = (usd: number) => Math.round(usd * 1_000_000);
export const microsToUsd = (micros: number | string | null) => (micros === null ? null : Number(micros) / 1_000_000);

/**
 * The cost of `inputTokens` and `outputTokens` in micro-dollars, priced by the model that answered,
 * else by the configured model; null when neither has a price. Evaluated inside the INSERT of the
 * request's log row, so the price is the one in force when the request ended.
 */
export function costExpression(provider: AiProviderName, answered: string, configured: string, inputTokens: number, outputTokens: number): RawBuilder<string | null> {
  return sql<string | null>`(
    SELECT ceil(${inputTokens}::numeric * p.input_usd_per_mtok + ${outputTokens}::numeric * p.output_usd_per_mtok)::bigint
    FROM ai_model_prices p
    WHERE p.provider = ${provider} AND p.model IN (${answered}, ${configured})
    ORDER BY (p.model = ${answered}) DESC
    LIMIT 1)`;
}

/** What all schools' AI requests have cost since `since`, in micro-dollars, and how many had no price. */
export async function platformSpend(exec: Executor, since: Date): Promise<{ micros: number; unpriced: number }> {
  const { rows } = await sql<{ micros: string | null; unpriced: string }>`
    SELECT sum(cost_usd_micros) AS micros, count(*) FILTER (WHERE cost_usd_micros IS NULL AND status <> 'failed') AS unpriced
    FROM ai_requests WHERE created_at >= ${since}`.execute(exec);
  return { micros: Number(rows[0]?.micros ?? 0), unpriced: Number(rows[0]?.unpriced ?? 0) };
}

export async function hasPrice(exec: Executor, provider: AiProviderName, model: string): Promise<boolean> {
  const row = await exec.selectFrom('ai_model_prices').select('model').where('provider', '=', provider).where('model', '=', model).executeTakeFirst();
  return Boolean(row);
}

export type BudgetState = 'off' | 'ok' | 'high' | 'reached' | 'unpriced';

/** Percentage of the budget at which an alert warns (ai_budget_high) before requests are refused. */
export const BUDGET_WARN_PERCENT = 80;

/** Where the platform stands against AI_MONTHLY_BUDGET_USD this month (read across all schools). */
export async function budgetState(
  exec: Executor,
  config: Pick<AppConfig, 'AI_MONTHLY_BUDGET_USD'>,
  provider: AiProviderName,
  model: string,
): Promise<{ state: BudgetState; spentMicros: number; budgetMicros: number }> {
  const budgetMicros = usdToMicros(config.AI_MONTHLY_BUDGET_USD);
  if (budgetMicros === 0) return { state: 'off', spentMicros: 0, budgetMicros };
  const { micros } = await platformSpend(exec, monthStart());
  // Without a price the spending cannot be measured, so the budget cannot be kept: refuse.
  if (!(await hasPrice(exec, provider, model))) return { state: 'unpriced', spentMicros: micros, budgetMicros };
  const state = micros >= budgetMicros ? 'reached' : micros * 100 >= budgetMicros * BUDGET_WARN_PERCENT ? 'high' : 'ok';
  return { state, spentMicros: micros, budgetMicros };
}

/**
 * Refuses a new AI request when the platform's budget is reached, or when a budget is set and the
 * configured model has no price. Checked before any allowance is taken. Requests already running
 * when the budget is reached finish, so the month can end above it by what they cost.
 */
export async function checkPlatformBudget(db: Database, config: Pick<AppConfig, 'AI_MONTHLY_BUDGET_USD'>, provider: AiProviderName, model: string): Promise<void> {
  if (config.AI_MONTHLY_BUDGET_USD === 0) return;
  const { state } = await withSystemContext(db, (trx) => budgetState(trx, config, provider, model));
  if (state === 'reached' || state === 'unpriced') throw aiPaused();
}
