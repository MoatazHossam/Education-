import { sql, type Kysely } from 'kysely';

// AI cost controls, second part (docs/production/AI_COST_CONTROL_PLAN.md AI-3, AI-6; docs/AI_LAYER.md §3):
//
// - ai_model_prices: what the provider charges per million input and output tokens, per model, in US
//   dollars, entered by a platform administrator from the provider's price page. Nothing is assumed:
//   a model without a row has no price. Platform-wide, like plans: no school's data.
// - ai_requests.cost_usd_micros: the request's cost in millionths of a dollar, priced when it is
//   logged (the model that answered, else the configured one); null when neither has a price.
//   One dollar per million tokens is one millionth of a dollar per token, so the cost is
//   tokens × price, rounded up. The month's sum is what AI_MONTHLY_BUDGET_USD is checked against.
const UP = `
CREATE TABLE ai_model_prices (
  provider text NOT NULL CHECK (provider IN ('gemini', 'anthropic', 'openai')),
  model text NOT NULL CHECK (length(model) BETWEEN 1 AND 100),
  input_usd_per_mtok numeric(12, 6) NOT NULL CHECK (input_usd_per_mtok >= 0),
  output_usd_per_mtok numeric(12, 6) NOT NULL CHECK (output_usd_per_mtok >= 0),
  updated_by uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (provider, model)
);

ALTER TABLE ai_requests ADD COLUMN cost_usd_micros bigint CHECK (cost_usd_micros >= 0);
`;

const DOWN = `
ALTER TABLE ai_requests DROP COLUMN IF EXISTS cost_usd_micros;
DROP TABLE IF EXISTS ai_model_prices;
`;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function up(db: Kysely<any>): Promise<void> {
  await sql.raw(UP).execute(db);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function down(db: Kysely<any>): Promise<void> {
  await sql.raw(DOWN).execute(db);
}
