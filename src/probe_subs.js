// Decides the concept: can we drive a subscription lifecycle server-side?
import { pp, ppOrThrow } from './paypal.js';

const rid = () => Math.random().toString(36).slice(2, 10);

console.log('--- 1. create catalog product');
const product = await ppOrThrow('POST', '/v1/catalogs/products', {
  name: 'Fermata Studio Membership',
  type: 'SERVICE',
  category: 'SOFTWARE',
}, { 'PayPal-Request-Id': `prod-${rid()}` });
console.log('   product', product.id);

async function makePlan(name, value) {
  const plan = await ppOrThrow('POST', '/v1/billing/plans', {
    product_id: product.id,
    name,
    status: 'ACTIVE',
    billing_cycles: [{
      frequency: { interval_unit: 'MONTH', interval_count: 1 },
      tenure_type: 'REGULAR',
      sequence: 1,
      total_cycles: 0,
      pricing_scheme: { fixed_price: { value, currency_code: 'USD' } },
    }],
    payment_preferences: {
      auto_bill_outstanding: true,
      setup_fee_failure_action: 'CONTINUE',
      payment_failure_threshold: 3,
    },
  }, { 'PayPal-Request-Id': `plan-${rid()}` });
  console.log(`   plan ${name} ($${value}) ->`, plan.id);
  return plan;
}

console.log('--- 2. create two plans (full + downgrade target)');
const full = await makePlan('Studio — Full', '29.00');
const lite = await makePlan('Studio — Lite', '9.00');

console.log('--- 3. create subscription');
const sub = await ppOrThrow('POST', '/v1/billing/subscriptions', {
  plan_id: full.id,
  subscriber: { name: { given_name: 'Test', surname: 'Member' }, email_address: 'sb-hxdg953751110@personal.example.com' },
  application_context: {
    brand_name: 'Fermata',
    user_action: 'SUBSCRIBE_NOW',
    return_url: 'https://example.com/ok',
    cancel_url: 'https://example.com/no',
  },
}, { 'PayPal-Request-Id': `sub-${rid()}` });

console.log('   subscription', sub.id, 'status:', sub.status);
console.log('   links:');
for (const l of sub.links || []) console.log(`     ${l.rel.padEnd(10)} ${l.method.padEnd(5)} ${l.href}`);

console.log('--- 4. can we act on an APPROVAL_PENDING subscription server-side?');
for (const [m, p, b] of [
  ['POST', `/v1/billing/subscriptions/${sub.id}/suspend`, { reason: 'probe' }],
  ['POST', `/v1/billing/subscriptions/${sub.id}/activate`, { reason: 'probe' }],
]) {
  const r = await pp(m, p, b);
  console.log(`   ${r.status} ${p.split('/').pop()} ${r.ok ? 'OK' : (r.body?.details?.[0]?.issue || r.body?.name || '')}`);
}

console.log('\nPLAN_FULL=' + full.id + '\nPLAN_LITE=' + lite.id + '\nSUB=' + sub.id + '\nPRODUCT=' + product.id);
