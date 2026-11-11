// PayPal subscription lifecycle adapter.
// Every function here maps 1:1 onto a documented PayPal REST call, so the
// agent's decisions are always executed as real, inspectable API actions.
import { pp, ppOrThrow } from './paypal.js';

export const getSubscription = (id) =>
  ppOrThrow('GET', `/v1/billing/subscriptions/${id}`);

export const getPlan = (id) => ppOrThrow('GET', `/v1/billing/plans/${id}`);

export const listPlans = () =>
  ppOrThrow('GET', '/v1/billing/plans?page_size=20&total_required=true');

/** Pause billing. Reversible — this is what makes the demo safe to re-run. */
export const suspend = (id, reason) =>
  pp('POST', `/v1/billing/subscriptions/${id}/suspend`, { reason });

/** Resume a paused subscription. */
export const activate = (id, reason) =>
  pp('POST', `/v1/billing/subscriptions/${id}/activate`, { reason });

/** Irreversible — kept behind an explicit confirmation in the UI. */
export const cancel = (id, reason) =>
  pp('POST', `/v1/billing/subscriptions/${id}/cancel`, { reason });

/** Move the subscriber to a different plan (the downgrade path). */
export const revise = (id, planId) =>
  pp('POST', `/v1/billing/subscriptions/${id}/revise`, { plan_id: planId });

/** Transaction history for a subscription — evidence for the decision. */
export async function transactions(id, days = 365) {
  const end = new Date();
  const start = new Date(end.getTime() - days * 864e5);
  const q = `start_time=${start.toISOString().slice(0, 19)}Z&end_time=${end.toISOString().slice(0, 19)}Z`;
  const r = await pp('GET', `/v1/billing/subscriptions/${id}/transactions?${q}`);
  return r.ok ? r.body?.transactions || [] : [];
}

/**
 * PayPal does not expose whether a subscription has a plan change awaiting the
 * subscriber's approval, so we record it ourselves in custom_id. That survives
 * a server restart and a free-tier spin-down, which an in-process Set does not.
 */
export const setCustomId = (id, value) =>
  pp('PATCH', `/v1/billing/subscriptions/${id}`, [
    { op: 'replace', path: '/custom_id', value },
  ]);

/**
 * Retry an outstanding balance — the actual remedy for involuntary churn,
 * where a subscription is dying from a failed card rather than a decision.
 */
export const captureOutstanding = (id, amount, note) =>
  pp('POST', `/v1/billing/subscriptions/${id}/capture`, {
    note: note || 'Retrying the outstanding balance',
    capture_type: 'OUTSTANDING_BALANCE',
    amount: { currency_code: 'USD', value: Number(amount).toFixed(2) },
  });
