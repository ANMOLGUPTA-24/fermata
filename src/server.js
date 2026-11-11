// Zero-dependency HTTP server: nothing to npm-install, so the Render deploy
// cannot break on a transitive dependency weeks from now.
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname } from 'node:path';
import * as subs from './subscriptions.js';
import { decide, planPrice } from './engine.js';
import { MODEL_NAME } from './ai.js';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..');
const PORT = process.env.PORT || 3000;

const seed = JSON.parse(await readFile(join(ROOT, 'data', 'seed.json'), 'utf8'));

/** Decision receipts for this process. PayPal remains the source of truth. */
const receipts = [];

/**
 * Verdicts issued by /api/decide, keyed by id. /api/execute will only perform an
 * action that appears in a verdict this server actually issued, for the
 * subscription it was issued against. The client cannot name its own action.
 */
const verdicts = new Map();
const VERDICT_TTL = 15 * 60_000;

/**
 * Outstanding plan-change consent is recorded on PayPal itself, in the
 * subscription's custom_id, because PayPal does not otherwise expose the
 * pending state and an in-process Set does not survive a restart or a
 * free-tier spin-down.
 */
const AWAIT = 'FERMATA_AWAITING_CONSENT:';
const awaitingConsent = (sub) => String(sub?.custom_id || '').startsWith(AWAIT);

async function markAwaitingConsent(id, targetPlanId) {
  return subs.setCustomId(id, `${AWAIT}${targetPlanId}`);
}
async function clearAwaitingConsent(id) {
  return subs.setCustomId(id, '-');
}

/** What subscribers did on the cancel page, newest first, for the desk to show. */
const events = [];

/** Small in-memory guards so a public demo cannot burn the free model quota. */
const hits = new Map();
function throttled(ip, limit = 20, windowMs = 10 * 60_000) {
  const now = Date.now();
  const list = (hits.get(ip) || []).filter((t) => now - t < windowMs);
  list.push(now);
  hits.set(ip, list);
  return list.length > limit;
}
const decisionCache = new Map(); // same subscriber state + same words => same decision
const CACHE_TTL = 10 * 60_000;

/** Destructive actions are disabled on the shared hosted demo. */
const ALLOW_DESTRUCTIVE = process.env.ALLOW_DESTRUCTIVE === 'true';

const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.json': 'application/json' };

const clientIp = (req) => String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();

const json = (res, code, body) => {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
};

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {};
}

/** Live state from PayPal. Subscriptions are always fresh; plan definitions are
 *  cached briefly because they are immutable in practice and cost a round trip each. */
let planCache = { at: 0, plans: null };

async function loadPlans() {
  if (planCache.plans && Date.now() - planCache.at < 60_000) return planCache.plans;
  const plansResp = await subs.listPlans();
  const wanted = (plansResp.plans || []).filter((p) => seed.planIds.includes(p.id));
  // listPlans omits billing_cycles, so fetch each definition - in parallel.
  const plans = await Promise.all(wanted.map((p) => subs.getPlan(p.id)));
  planCache = { at: Date.now(), plans };
  return plans;
}

async function loadState() {
  const [plans, subscriptions] = await Promise.all([
    loadPlans(),
    Promise.all(seed.subscriptionIds.map(async (id) => {
      try { return await subs.getSubscription(id); }
      catch (e) { return { id, status: 'UNREACHABLE', error: String(e.message).slice(0, 160) }; }
    })),
  ]);
  return { plans, subscriptions };
}

const routes = {
  'GET /healthz': async () => ({ ok: true }),

  'GET /api/state': async () => {
    const { plans, subscriptions } = await loadState();
    return {
      model: MODEL_NAME,
      environment: process.env.PAYPAL_BASE?.includes('sandbox') ? 'sandbox' : 'live',
      plans: plans.map((p) => ({ id: p.id, name: p.name, price: planPrice(p), status: p.status })),
      people: seed.people || {},
      allowDestructive: ALLOW_DESTRUCTIVE,
      subscriptions,
      events,
      receipts,
    };
  },

  'POST /api/decide': async (body, req) => {
    if (!seed.subscriptionIds.includes(body.subscriptionId)) {
      return { error: 'Unknown subscription. This demo only acts on its own seeded subscribers.' };
    }
    const text = String(body.text || '').slice(0, 1200);
    if (!text.trim()) return { error: 'Say something first.' };
    if (throttled(clientIp(req))) {
      return { error: 'This shared demo limits how often one visitor can ask for a decision. Give it a few minutes.' };
    }
    const subscription = await subs.getSubscription(body.subscriptionId);
    const [plans, history] = await Promise.all([loadPlans(), subs.transactions(body.subscriptionId)]);
    const cacheKey = [body.subscriptionId, subscription.status, subscription.plan_id, awaitingConsent(subscription), text.trim().toLowerCase()].join('|');
    const cached = decisionCache.get(cacheKey);
    let verdict;
    if (cached && Date.now() - cached.at < CACHE_TTL) {
      verdict = cached.verdict;
    } else {
      try {
        verdict = await decide({
          subscription,
          plans,
          history,
          signal: {
            type: 'cancel_intent',
            text,
            subscriberName: seed.people?.[body.subscriptionId]?.name,
          },
          pendingConsent: awaitingConsent(subscription),
        });
      } catch (err) {
        if (/429|RESOURCE_EXHAUSTED/i.test(String(err))) {
          return { error: 'The free AI quota for this demo is used up for the moment. Please try again in a little while.' };
        }
        throw err;
      }
      decisionCache.set(cacheKey, { at: Date.now(), verdict });
    }

    const source = body.source === 'subscriber' ? 'subscriber' : 'desk';
    const id = randomUUID();
    verdicts.set(id, { at: Date.now(), subscriptionId: body.subscriptionId, verdict, source, text });
    if (source === 'subscriber') {
      events.unshift({ id, at: new Date().toISOString(), subscriptionId: body.subscriptionId, text, offered: verdict.chosen_action, offerLabel: verdict.plan?.label, outcome: 'offer shown' });
      events.length = Math.min(events.length, 30);
    }
    for (const [k, v] of verdicts) if (Date.now() - v.at > VERDICT_TTL) verdicts.delete(k);

    return { subscription, verdict: { ...verdict, verdictId: id } };
  },

  'POST /api/execute': async (body) => {
    const issued = verdicts.get(body.verdictId);
    if (!issued) {
      return { error: 'No such verdict. Actions can only be executed from a decision this server issued — the client cannot name its own action.' };
    }
    if (issued.subscriptionId !== body.subscriptionId) {
      return { error: 'Verdict does not belong to this subscription.' };
    }

    const subscriptionId = issued.subscriptionId;
    const action = issued.verdict.chosen_action;
    const targetPlanId = issued.verdict.plan?.targetPlanId;
    const reason = (issued.verdict.reasoning || '').slice(0, 120);

    if (!issued.verdict.actions.some((a) => a.action === action)) {
      return { error: `"${action}" was not in the permitted set for this subscription.` };
    }
    if ((action === 'release' || action === 'downgrade') && !ALLOW_DESTRUCTIVE) {
      return { error: action === 'release'
        ? 'Decided, not executed: cancelling is irreversible, so it is switched off on this shared demo — one visitor could otherwise use it up for everyone. Run locally with ALLOW_DESTRUCTIVE=true; the code path is identical.'
        : 'Decided, not executed: a plan change stages a consent request that only the subscriber can clear, so it is switched off on this shared demo. Run locally with ALLOW_DESTRUCTIVE=true; the code path is identical.' };
    }

    const before = await subs.getSubscription(subscriptionId);
    if (action === 'pause' && awaitingConsent(before)) {
      return { error: 'Refused: this subscription has a plan change awaiting the subscriber\'s approval. Pausing it now would make it impossible to reactivate until they approve.' };
    }

    let call;
    if (action === 'pause') call = await subs.suspend(subscriptionId, reason || 'Retention pause');
    else if (action === 'resume') call = await subs.activate(subscriptionId, reason || 'Subscriber returning');
    else if (action === 'downgrade') call = await subs.revise(subscriptionId, targetPlanId);
    else if (action === 'release') call = await subs.cancel(subscriptionId, reason || 'Subscriber chose to leave');
    else if (action === 'escalate') call = { ok: true, status: 0, body: { note: 'No PayPal call — handed to a human.' } };
    else return { error: `Unknown action "${action}"` };

    const after = await subs.getSubscription(subscriptionId);

    // A plan change needs the subscriber's consent: PayPal hands back an
    // approval link rather than moving them silently. We surface it, and record
    // the outstanding consent on PayPal so the flag survives a restart.
    const consentLink = (call.body?.links || []).find((l) => l.rel === 'approve')?.href || null;
    if (consentLink) await markAwaitingConsent(subscriptionId, targetPlanId);

    verdicts.delete(body.verdictId);
    const ev = events.find((e) => e.id === body.verdictId);
    if (ev) ev.outcome = call.ok ? `accepted: ${action}` : `failed: ${action}`;

    const receipt = {
      source: issued.source || 'desk',
      at: new Date().toISOString(),
      subscriptionId,
      action,
      targetPlanId: targetPlanId || null,
      paypalCall: call.status ? `HTTP ${call.status}` : 'n/a',
      ok: call.ok,
      debugId: call.debugId || null,
      statusBefore: before.status,
      statusAfter: after.status,
      planBefore: before.plan_id,
      planAfter: after.plan_id,
      consentLink,
      requiresConsent: Boolean(consentLink),
      response: call.body ?? null,
    };
    receipts.unshift(receipt);
    return { receipt, subscription: after };
  },

  // The subscriber's own exit. Deliberately NOT a model decision: the way out is
  // always there, whatever the engine thinks.
  'POST /api/cancel-anyway': async (body) => {
    if (!seed.subscriptionIds.includes(body.subscriptionId)) return { error: 'Unknown subscription.' };
    const ev = events.find((e) => e.id === body.verdictId);
    if (!ALLOW_DESTRUCTIVE) {
      if (ev) ev.outcome = 'declined the offer — chose to cancel (not executed on shared demo)';
      return { executed: false, note: 'On this shared demo the cancellation is recorded but not executed, so one visitor cannot use the demo up for everyone. Locally, with ALLOW_DESTRUCTIVE=true, this calls PayPal\'s cancel endpoint.' };
    }
    const before = await subs.getSubscription(body.subscriptionId);
    const call = await subs.cancel(body.subscriptionId, 'Subscriber chose to cancel');
    const after = await subs.getSubscription(body.subscriptionId);
    if (ev) ev.outcome = 'declined the offer — cancelled';
    receipts.unshift({ source: 'subscriber', at: new Date().toISOString(), subscriptionId: body.subscriptionId, action: 'cancel (subscriber\'s own choice)', paypalCall: `HTTP ${call.status}`, ok: call.ok, debugId: call.debugId || null, statusBefore: before.status, statusAfter: after.status });
    return { executed: call.ok, status: after.status };
  },

  'POST /api/reset': async () => {
    // Puts every seeded subscription back to ACTIVE so the demo is repeatable.
    const out = [];
    for (const id of seed.subscriptionIds) {
      try {
        const s = await subs.getSubscription(id);
        if (awaitingConsent(s)) {
          const target = String(s.custom_id).slice(AWAIT.length);
          if (s.plan_id === target) await clearAwaitingConsent(id); // change landed
        }
        if (s.status === 'SUSPENDED') {
          const r = await subs.activate(id, 'Demo reset');
          const stranded = !r.ok && JSON.stringify(r.body || {}).includes('SESSION_STATE_NOT_VALID');
          out.push({
            id,
            from: 'SUSPENDED',
            ok: r.ok,
            ...(stranded ? {
              stranded: true,
              explain: 'PayPal refuses to reactivate this subscription because a plan change is still awaiting the subscriber\'s approval. The subscriber must approve (or the subscription must be replaced) before it can resume.',
            } : {}),
          });
        } else {
          out.push({ id, from: s.status, ok: true, skipped: true });
        }
      } catch (e) {
        out.push({ id, error: String(e.message).slice(0, 120) });
      }
    }
    receipts.length = 0;
    events.length = 0;
    verdicts.clear();
    return { reset: out };
  },
};

createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const key = `${req.method} ${url.pathname}`;

  if (routes[key]) {
    try {
      const body = req.method === 'POST' ? await readBody(req) : {};
      return json(res, 200, await routes[key](body, req));
    } catch (err) {
      console.error(key, err);
      const slow = /timeout|aborted|fetch failed|ENETUNREACH|ECONNRESET/i.test(String(err));
      return json(res, slow ? 503 : 500, {
        error: slow
          ? 'PayPal or the AI model took too long to answer just now. Nothing was changed. Please try again.'
          : String(err.message || err),
      });
    }
  }

  // static
  let file = url.pathname === '/' ? '/index.html' : url.pathname === '/cancel' ? '/cancel.html' : url.pathname;
  if (file.includes('..')) file = '/index.html';
  try {
    const buf = await readFile(join(ROOT, 'public', file));
    res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream' });
    res.end(buf);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
  }
}).listen(PORT, () => console.log(`Fermata listening on :${PORT}`));
