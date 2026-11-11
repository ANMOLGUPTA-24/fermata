// Milestone zero: prove a real sandbox token and a real API call, before anything else is built.
import { accessToken, pp } from './paypal.js';

const t = await accessToken();
console.log('OAuth token acquired:', t.slice(0, 6) + '…', `(length ${t.length})`);

const probes = [
  ['GET',  '/v1/identity/oauth2/userinfo?schema=paypalv1.1'],
  ['POST', '/v2/checkout/orders'],
  ['GET',  '/v2/invoicing/invoices?page_size=1'],
  ['GET',  '/v1/customer/disputes?page_size=2'],
  ['GET',  '/v1/billing/plans?page_size=1'],
  ['GET',  '/v1/catalogs/products?page_size=1'],
  ['GET',  '/v1/notifications/webhooks'],
  ['GET',  '/v1/payments/payouts/NONEXISTENT'],
];

for (const [method, path] of probes) {
  let payload;
  if (method === 'POST' && path === '/v2/checkout/orders') {
    payload = {
      intent: 'CAPTURE',
      purchase_units: [{ amount: { currency_code: 'USD', value: '1.00' } }],
    };
  }
  const r = await pp(method, path, payload);
  const note = r.body?.name || r.body?.message || (r.body?.id ? `id=${r.body.id}` : '');
  console.log(`${r.ok ? 'OK  ' : 'FAIL'} ${String(r.status).padEnd(3)} ${method} ${path}  ${note}`);
}
