// Minimal PayPal REST client for the sandbox environment.
// No SDK dependency: one token cache + one request helper, so every call is visible.
const BASE = process.env.PAYPAL_BASE || 'https://api-m.sandbox.paypal.com';

let cached = { token: null, expiresAt: 0 };

export async function accessToken() {
  if (cached.token && Date.now() < cached.expiresAt - 60_000) return cached.token;
  const id = process.env.PAYPAL_CLIENT_ID;
  const secret = process.env.PAYPAL_SECRET;
  if (!id || !secret) throw new Error('PAYPAL_CLIENT_ID / PAYPAL_SECRET are not set');
  const res = await fetch(`${BASE}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: 'Basic ' + Buffer.from(`${id}:${secret}`).toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
    signal: AbortSignal.timeout(15_000),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`PayPal auth failed (${res.status}): ${JSON.stringify(body)}`);
  cached = { token: body.access_token, expiresAt: Date.now() + body.expires_in * 1000 };
  return cached.token;
}

/** Every PayPal call in this project goes through here, so each one is logged and auditable. */
export async function pp(method, path, body, extraHeaders = {}) {
  // Reads are safe to repeat, so a stalled sandbox read gets a second and third
  // try. Writes are sent once: repeating a suspend or cancel blindly is not safe.
  const tries = method === 'GET' ? 3 : 1;
  let lastErr;
  for (let attempt = 1; attempt <= tries; attempt++) {
    try {
      const token = await accessToken();
      const res = await fetch(`${BASE}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          ...extraHeaders,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(method === 'GET' ? 10_000 : 20_000),
      });
      const text = await res.text();
      let parsed = null;
      try { parsed = text ? JSON.parse(text) : null; } catch { parsed = { raw: text }; }
      if (res.status >= 500 && attempt < tries) { lastErr = new Error(`PayPal ${res.status}`); continue; }
      return { ok: res.ok, status: res.status, body: parsed, debugId: res.headers.get('paypal-debug-id') };
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr;
}

export async function ppOrThrow(method, path, body, extraHeaders) {
  const r = await pp(method, path, body, extraHeaders);
  if (!r.ok) {
    throw new Error(`PayPal ${method} ${path} -> ${r.status} ${JSON.stringify(r.body)} (debug-id ${r.debugId})`);
  }
  return r.body;
}
