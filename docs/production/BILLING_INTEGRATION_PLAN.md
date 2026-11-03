# Billing integration plan

Audited: `main` at `d66de3b`. Evidence labels as in [PRODUCTION_READINESS_AUDIT.md §0](PRODUCTION_READINESS_AUDIT.md).
Statements about Paymob's products are **[ASSUMPTION]** until confirmed with Paymob and in test mode; the
adapter has never been run against Paymob's servers (B-2 **[DOC]**).

## 1. What exists [V-code]

| Piece | Implementation | Source |
| --- | --- | --- |
| Plans | Free, Starter (EGP 990/mo), Professional (EGP 2,900/mo), Enterprise (sales-led); prices in minor units; editable by platform admins | `src/billing/plans.ts:21-70` |
| Subscription state | `trialing` / `active` / `past_due`, period start/end, `cancel_at_period_end`, pending plan change, grace, per-org limit overrides | `src/db/migrations/0001_initial.ts:256-276` |
| Invoices | Sequential numbers, kinds `subscription/renewal/upgrade/manual`, `open/paid/void` | `0001_initial.ts:284-300` |
| Lifecycle (worker) | Trial notices and expiry, renewal invoice before period end, past-due with grace, move to Free, scheduled downgrades | `src/billing/service.ts:356-456` |
| Proration | Upgrades charged pro rata for the remaining period | `src/billing/service.ts:24-31` |
| Provider abstraction | `createCheckout` + `parseWebhook`; providers move money only; state lives in our DB | `src/billing/providers/types.ts:1-49` |
| Paymob adapter | Intention API + Unified Checkout per invoice; HMAC-SHA512 verification of the transaction callback | `src/billing/providers/paymob.ts:126-198` |
| Webhook endpoint | Raw body; signature check; insert-or-skip on `(provider, event_id)`; failed events can be retried; 500 makes the provider retry | `src/billing/routes.ts:156-201` |
| Payment safety | Invoice resolved from the signed checkout reference, not the echoed id (`checkout_sessions`); unique `(provider, provider_txn_id)`; amount and currency must match; payments on closed invoices flagged for refund review | `src/billing/service.ts:225-301`, `0002_checkout_sessions.ts` |
| Manual path | `BILLING_PROVIDER=disabled` and operator-marked invoices | `src/config.ts:38`, `src/admin/routes.ts` |
| Production guard | Sandbox provider refused in production | `src/config.ts:92-94`, CI smoke test `.github/workflows/ci.yml:92-101` |
| Check tool | `npm run paymob:check` against test-mode keys | `src/cli/paymob-check.ts` |

This is a sound base: idempotency, signature verification and amount checks are already right.

## 2. Gaps for commercial launch

| ID | Gap | Severity | Notes |
| --- | --- | --- | --- |
| B-G1 | **No automatic recurring charge.** Each renewal is an invoice the owner pays through a new hosted checkout link; nothing is charged automatically | High (revenue, churn) | `service.ts:411-452` issues renewal invoices; there is no saved card/token in the schema [V-code]. Paymob offers card tokenisation and a subscriptions product [ASSUMPTION] |
| B-G2 | **No reconciliation.** A lost or delayed callback leaves an invoice open although the customer paid; nothing queries Paymob for the transaction state | High | No inquiry call in `paymob.ts` [V-code] |
| B-G3 | Refunds, voids and chargebacks are ignored with "manual review" and no operator queue | Medium | `paymob.ts:193` returns `ignored` [V-code] |
| B-G4 | One currency per deployment (`BILLING_CURRENCY`); plans seeded in it | High for KSA/UAE | `src/config.ts:39`, `src/db/seed-cli.ts:13` [V-code] |
| B-G5 | No tax: invoices are net; no VAT number, rate, or tax-compliant invoice layout; no e-invoicing (Egypt ETA, Saudi ZATCA) | High (legal) | `SECURITY_DESIGN.md §7` [DOC] |
| B-G6 | Customer billing details are minimal: `billing_data` sends `phone_number: 'NA'` and splits the owner's name | Medium | `paymob.ts:150` [V-code]; Paymob may require real phone/address for some methods [ASSUMPTION] |
| B-G7 | Webhook endpoint relies on the global flood guard only | Low | `src/billing/routes.ts:161` has no route limit; signature check is cheap [V-code] |
| B-G8 | Not run against Paymob; the `redirection_url` path is not used to mark payment (correct), but the return page UX for "processing" needs a real test | Blocked | B-2 [DOC] |

## 3. Target design

### 3.1 Recurring subscriptions (B-G1)

Keep our database as the source of truth for subscription state (as now); use the provider only to charge.

1. **First payment** stays a hosted checkout. Ask Paymob to save the card as a token on that payment (tokenisation
   flag on the intention) **[ASSUMPTION — confirm the exact Paymob parameter and that tokens are returned in the
   callback]**.
2. Store only the token reference, card brand and last four digits in a new `payment_methods` table (RLS, per
   org). No card data touches the app, keeping PCI scope at hosted-checkout level **[ASSUMPTION — confirm SAQ type
   with Paymob]**.
3. At renewal, the worker charges the token server-to-server (merchant-initiated transaction) for the renewal
   invoice, with the invoice id as idempotency reference. Success arrives through the same webhook path.
4. Failure → existing `past_due` + grace + emails; the owner can pay by link as today (fallback kept).
5. Wallets and other non-card methods (Fawry, mobile wallets, KNET/mada/Apple Pay depending on country) cannot be
   charged automatically **[ASSUMPTION]**: those customers keep pay-by-link renewals, which the code already does.

Alternative if Paymob's subscription product fits better: let Paymob schedule charges and treat its callbacks as
renewals. This moves state to the provider and makes multi-provider harder; not recommended first.

### 3.2 Idempotent webhooks (keep, then harden)

Already correct [V-code]: claim-by-insert on `(provider, event_id)`, retry only failed events, unique transaction
id, amount/currency match, signed checkout binding. Add:
- A route rate limit (e.g. 600/min) and request-size cap on `/api/billing/webhooks/:provider`.
- Platform admin view of `billing_events` with status `failed`/`ignored` and a "reprocess" action (exists partly:
  "Platform admin → Webhooks" **[DOC]**).

### 3.3 Reconciliation (B-G2, B-G3)

A worker job every 15 minutes, and a daily full pass:
1. For each `checkout_sessions` row whose invoice is still `open` after 10 minutes, query Paymob for the order's
   transactions (server-to-server, authenticated) **[ASSUMPTION — Paymob transaction inquiry API]** and apply the
   result through `applyProviderEvent` (same idempotency, so a late webhook is harmless).
2. Daily: compare the provider's settlement report for the previous day with `payments`; record mismatches in a
   `billing_reconciliation_issues` table and raise an operational alert.
3. Refund/void/chargeback callbacks create an operator task instead of being ignored silently; an operator decides
   whether to reopen the invoice or downgrade.

### 3.4 Countries, currencies, tax (B-G4, B-G5)

- Add `country` and `billing_currency` to `organizations` (or to `subscriptions`), and price plans per currency
  (`plan_prices(plan_id, currency, interval, amount)`), selected at checkout.
- Paymob merchant accounts are per country **[ASSUMPTION]**: configuration becomes a map of
  country → Paymob credentials, or one deployment per country. Decide before building (PRODUCTION_LAUNCH_CHECKLIST
  §2, D-3).
- Tax: store seller tax registration, customer tax number (B2B schools), rate per country, tax amount on each
  invoice, and a compliant invoice PDF. Egypt ETA and Saudi ZATCA e-invoicing integrations are separate projects
  that depend on where the company is registered (D-1). **Do not build before the accountant's answer.**

## 4. Implementation steps

| Step | Depends on | Acceptance criteria | Verification |
| --- | --- | --- | --- |
| P-1 Paymob test-mode run | Test keys (C-3) | One card payment and one failure in test mode reach the webhook, mark/leave the invoice correctly; HMAC accepted | `npm run paymob:check`; Platform admin → Webhooks shows `processed` |
| P-2 Webhook route limit + admin reprocess | — | 601st request/min gets 429; a failed event can be reprocessed once | `npm run test:integration -- billing paymob-contract` |
| P-3 Reconciliation job | P-1 | Dropping the webhook in staging still marks the invoice paid within 15 min; mismatch raises an alert | Integration test with the Paymob simulator (`tests/helpers/paymob-simulator.ts`) extended with an inquiry endpoint |
| P-4 Refund/void handling | P-1 | Refund callback creates an operator task and audit entry | Integration test |
| P-5 Saved card + automatic renewal | P-1, Paymob confirmation | Renewal invoice is charged without user action; failure falls back to pay-by-link | Simulator contract test + test-mode run with a test card |
| P-6 Multi-currency plans | D-3 | A Saudi org sees SAR prices and is charged in SAR; EGP orgs unchanged | Integration tests per currency |
| P-7 Tax on invoices | D-1, accountant | Invoice shows net, rate, tax, gross; totals reconcile | Unit tests on totals; accountant sign-off |

## 5. Verification commands

```bash
npm run test:integration -- billing paymob-contract    # existing: lifecycle, signatures, idempotency
npm run test:unit -- billing-logic security-primitives
PAYMOB_SECRET_KEY=... PAYMOB_PUBLIC_KEY=... PAYMOB_HMAC_SECRET=... PAYMOB_INTEGRATION_IDS=... npm run paymob:check
# Idempotency on staging: replay the same signed callback twice; the second answers {"duplicate": true}
```
