import { describe, expect, it } from 'vitest';
import { effectivePlan } from '../../src/billing/entitlements.js';
import { formatMoney, prorationCents } from '../../src/billing/service.js';
import type { Subscription } from '../../src/db/types.js';
import { addDays, addMonths, periodKey } from '../../src/lib/time.js';

const now = new Date('2026-10-22T12:00:00Z');
const sub = (over: Partial<Subscription>): Subscription =>
  ({ plan_id: 'starter', status: 'active', trial_ends_at: null, current_period_start: null, current_period_end: null, cancel_at_period_end: false, grace_until: null, ...over }) as Subscription;

describe('effective plan', () => {
  it('free when no subscription or free plan', () => {
    expect(effectivePlan(null, now, 7)).toEqual({ planId: 'free', state: 'free' });
    expect(effectivePlan(sub({ plan_id: 'free' }), now, 7).state).toBe('free');
  });
  it('trial grants the plan until it ends, even if the worker has not run', () => {
    expect(effectivePlan(sub({ status: 'trialing', plan_id: 'professional', trial_ends_at: addDays(now, 1) }), now, 7)).toEqual({ planId: 'professional', state: 'trialing' });
    expect(effectivePlan(sub({ status: 'trialing', plan_id: 'professional', trial_ends_at: addDays(now, -1) }), now, 7)).toEqual({ planId: 'free', state: 'free' });
  });
  it('active period, then grace, then free', () => {
    expect(effectivePlan(sub({ current_period_end: addDays(now, 3) }), now, 7).state).toBe('active');
    expect(effectivePlan(sub({ current_period_end: addDays(now, -3) }), now, 7)).toEqual({ planId: 'starter', state: 'past_due' });
    expect(effectivePlan(sub({ current_period_end: addDays(now, -8) }), now, 7)).toEqual({ planId: 'free', state: 'free' });
    expect(effectivePlan(sub({ current_period_end: addDays(now, -1), cancel_at_period_end: true }), now, 7).state).toBe('free');
    expect(effectivePlan(sub({ status: 'past_due', grace_until: addDays(now, 2) }), now, 7).state).toBe('past_due');
    expect(effectivePlan(sub({ status: 'past_due', grace_until: addDays(now, -1) }), now, 7).state).toBe('free');
  });
  it('open-ended manual subscriptions stay active', () => {
    expect(effectivePlan(sub({ plan_id: 'enterprise' }), now, 7)).toEqual({ planId: 'enterprise', state: 'active' });
  });
});

describe('proration', () => {
  const start = new Date('2026-10-01T00:00:00Z');
  const end = new Date('2026-10-31T00:00:00Z');
  it('charges the price difference for the remaining fraction, rounded up', () => {
    const mid = new Date('2026-10-16T00:00:00Z');
    expect(prorationCents(99_000, 290_000, start, end, mid)).toBe(95_500);
    expect(prorationCents(99_000, 290_000, start, end, start)).toBe(191_000);
    expect(prorationCents(99_000, 290_000, start, end, end)).toBe(0);
  });
  it('never charges for a cheaper plan', () => {
    expect(prorationCents(290_000, 99_000, start, end, start)).toBe(0);
  });
});

describe('time helpers', () => {
  it('clamps month ends', () => {
    expect(addMonths(new Date('2026-01-31T10:00:00Z'), 1).toISOString()).toBe('2026-02-28T10:00:00.000Z');
    expect(addMonths(new Date('2028-01-31T10:00:00Z'), 1).toISOString()).toBe('2028-02-29T10:00:00.000Z');
    expect(addMonths(new Date('2026-03-15T00:00:00Z'), 12).toISOString()).toBe('2027-03-15T00:00:00.000Z');
  });
  it('formats usage periods in UTC', () => {
    expect(periodKey(new Date('2026-10-31T23:59:59Z'))).toBe('2026-10');
  });
  it('formats EGP amounts', () => {
    expect(formatMoney(99_000, 'EGP')).toMatch(/990/);
  });
});
