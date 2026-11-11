// Zero-dependency HTTP server: nothing to npm-install, so the Render deploy
// cannot break on a transitive dependency weeks from now.
import { createServer } from 'node:http';
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

/** Subscriptions with a plan change awaiting subscriber approval. */
const pendingConsent = new Set();

const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.json': 'application/json' };

const json = (res, code, body) => {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
};

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {};
}

/** Live state: every field comes from PayPal on each request. */
async function loadState() {
  const plansResp = await subs.listPlans();
  const plans = (plansResp.plans || []).filter((p) => seed.planIds.includes(p.id));
  const full = await Promise.all(
    plans.map(async (p) => ({ ...p, ...(await subs.getPlan(p.id)) }))
  );
  const subscriptions = [];
  for (const id of seed.subscriptionIds) {
    try {
      subscriptions.push(await subs.getSubscription(id));
    } catch (e) {
      subscriptions.push({ id, status: 'UNREACHABLE', error: String(e.message).slice(0, 160) });
    }
  }
  return { plans: full, subscriptions };
}

const routes = {
  'GET /api/state': async () => {
    const { plans, subscriptions } = await loadState();
    return {
      model: MODEL_NAME,
      environment: process.env.PAYPAL_BASE?.includes('sandbox') ? 'sandbox' : 'live',
      plans: plans.map((p) => ({ id: p.id, name: p.name, price: planPrice(p), status: p.status })),
      people: seed.people || {},
      pendingConsent: [...pendingConsent],
      subscriptions,
      receipts,
    };
  },

  'POST /api/decide': async (body) => {
    const subscription = await subs.getSubscription(body.subscriptionId);
    const { plans } = await loadState();
    const history = await subs.transactions(body.subscriptionId);
    const verdict = await decide({
      subscription,
      plans,
      history,
      signal: { type: body.signalType || 'cancel_intent', text: body.text || '' },
      pendingConsent: pendingConsent.has(body.subscriptionId),
    });
    return { subscription, verdict };
  },

  'POST /api/execute': async (body) => {
    const { subscriptionId, action, targetPlanId, reason } = body;

    if (action === 'pause' && pendingConsent.has(subscriptionId)) {
      return { error: 'Refused: this subscription has a plan change awaiting the subscriber\'s approval. Pausing it now would make it impossible to reactivate until they approve.' };
    }

    const before = await subs.getSubscription(subscriptionId);

    let call;
    if (action === 'pause') call = await subs.suspend(subscriptionId, reason || 'Retention pause');
    else if (action === 'resume') call = await subs.activate(subscriptionId, reason || 'Subscriber returning');
    else if (action === 'downgrade') call = await subs.revise(subscriptionId, targetPlanId);
    else if (action === 'release') call = await subs.cancel(subscriptionId, reason || 'Subscriber chose to leave');
    else if (action === 'escalate') call = { ok: true, status: 0, body: { note: 'No PayPal call — handed to a human.' } };
    else return { error: `Unknown action "${action}"` };

    const after = await subs.getSubscription(subscriptionId);

    // A plan change needs the subscriber's consent: PayPal hands back an
    // approval link rather than moving their money silently. We surface it.
    const consentLink = (call.body?.links || []).find((l) => l.rel === 'approve')?.href || null;

    const receipt = {
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
    if (consentLink) pendingConsent.add(subscriptionId);
    receipts.unshift(receipt);
    return { receipt, subscription: after };
  },

  'POST /api/reset': async () => {
    // Puts every seeded subscription back to ACTIVE so the demo is repeatable.
    const out = [];
    for (const id of seed.subscriptionIds) {
      try {
        const s = await subs.getSubscription(id);
        if (s.status === 'SUSPENDED') {
          const r = await subs.activate(id, 'Demo reset');
          out.push({ id, from: 'SUSPENDED', ok: r.ok });
        } else {
          out.push({ id, from: s.status, ok: true, skipped: true });
        }
      } catch (e) {
        out.push({ id, error: String(e.message).slice(0, 120) });
      }
    }
    receipts.length = 0;
    pendingConsent.clear();
    return { reset: out };
  },
};

createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const key = `${req.method} ${url.pathname}`;

  if (routes[key]) {
    try {
      const body = req.method === 'POST' ? await readBody(req) : {};
      return json(res, 200, await routes[key](body));
    } catch (err) {
      console.error(key, err);
      return json(res, 500, { error: String(err.message || err) });
    }
  }

  // static
  let file = url.pathname === '/' ? '/index.html' : url.pathname;
  try {
    const buf = await readFile(join(ROOT, 'public', file));
    res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream' });
    res.end(buf);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
  }
}).listen(PORT, () => console.log(`Fermata listening on :${PORT}`));
