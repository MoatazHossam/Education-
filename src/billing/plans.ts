import type { PlanFeatures, PlanLimits } from '../db/types.js';

export interface PlanDefinition {
  id: string;
  name: string;
  description: string;
  priceMonthlyCents: number;
  priceYearlyCents: number | null;
  limits: PlanLimits;
  features: PlanFeatures;
  isPublic: boolean;
  isSelfServe: boolean;
  sortOrder: number;
}

// Launch catalogue. Prices are in the billing currency's minor unit (EGP piastres).
// Rationale and assumptions: docs/SUBSCRIPTION_MODEL.md and docs/COMMERCIAL_FEASIBILITY.md.
// Platform administrators can adjust prices and limits at runtime; this list only seeds them.
// Student accounts (max_students) are off on every plan until priced: a platform
// administrator enables them for a school with a limit override.
export const PLAN_DEFINITIONS: PlanDefinition[] = [
  {
    id: 'free',
    name: 'Free',
    description: 'Browse the full catalogue and keep one content scope.',
    priceMonthlyCents: 0,
    priceYearlyCents: 0,
    limits: { max_members: 2, max_scopes: 1, exports_per_month: 5, api_requests_per_month: 0, audit_log_days: 7, max_students: 0 },
    features: { export_csv: false, export_json: false, api_access: false, require_mfa_policy: false, priority_support: false },
    isPublic: true,
    isSelfServe: true,
    sortOrder: 0,
  },
  {
    id: 'starter',
    name: 'Starter',
    description: 'For tutoring centres and small content teams.',
    priceMonthlyCents: 99_000,
    priceYearlyCents: 990_000,
    limits: { max_members: 5, max_scopes: 10, exports_per_month: 100, api_requests_per_month: 0, audit_log_days: 30, max_students: 0 },
    features: { export_csv: true, export_json: true, api_access: false, require_mfa_policy: true, priority_support: false },
    isPublic: true,
    isSelfServe: true,
    sortOrder: 1,
  },
  {
    id: 'professional',
    name: 'Professional',
    description: 'For ed-tech companies and publishers integrating scopes into their pipeline.',
    priceMonthlyCents: 290_000,
    priceYearlyCents: 2_900_000,
    limits: { max_members: 25, max_scopes: 100, exports_per_month: 1000, api_requests_per_month: 50_000, audit_log_days: 365, max_students: 0 },
    features: { export_csv: true, export_json: true, api_access: true, require_mfa_policy: true, priority_support: false },
    isPublic: true,
    isSelfServe: true,
    sortOrder: 2,
  },
  {
    id: 'enterprise',
    name: 'Enterprise',
    description: 'School groups and large publishers. Custom limits, invoicing and support.',
    priceMonthlyCents: 0,
    priceYearlyCents: null,
    limits: { max_members: null, max_scopes: null, exports_per_month: null, api_requests_per_month: null, audit_log_days: 730, max_students: 0 },
    features: { export_csv: true, export_json: true, api_access: true, require_mfa_policy: true, priority_support: true },
    isPublic: true,
    isSelfServe: false,
    sortOrder: 3,
  },
];

export const TRIAL_PLAN_ID = 'professional';
export const FREE_PLAN_ID = 'free';
