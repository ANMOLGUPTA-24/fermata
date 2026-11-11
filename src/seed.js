// Creates the demo catalogue in the PayPal sandbox and writes data/seed.json.
// Re-runnable: pass --subs N to mint N more subscriptions to approve.
import { writeFile, readFile } from 'node:fs/promises';
import { ppOrThrow } from './paypal.js';

const BUYER = process.env.SANDBOX_BUYER || 'sb-bhpsh53855618@personal.example.com';
const rid = () => Math.random().toString(36).slice(2, 10);
const H = () => ({ 'PayPal-Request-Id': rid(), Prefer: 'return=representation' });

const PLANS = [
  { key: 'full', name: 'Studio — Full',   price: '29.00', note: 'Everything, unlimited projects' },
  { key: 'lite', name: 'Studio — Lite',   price: '9.00',  note: 'One project, core tools' },
];

const PEOPLE = [
  { given_name: 'Priya',  surname: 'Raman',  note: 'Freelance illustrator. Two projects, steady usage.' },
  { given_name: 'Marcus', surname: 'Bell',   note: 'Agency owner. Heavy user, invoices clients monthly.' },
  { given_name: 'Lena',   surname: 'Okafor', note: 'Student. Signed up for one module, light usage.' },
  { given_name: 'Tomas',  surname: 'Varga',  note: 'Photographer. Seasonal — quiet every winter.' },
];

const product = await ppOrThrow('POST', '/v1/catalogs/products', {
  name: 'Fermata Studio',
  description: 'Creative studio software, billed monthly.',
  type: 'SERVICE',
  category: 'SOFTWARE',
}, H());
console.log('product', product.id);

const plans = {};
for (const p of PLANS) {
  const plan = await ppOrThrow('POST', '/v1/billing/plans', {
    product_id: product.id,
    name: p.name,
    description: p.note,
    status: 'ACTIVE',
    billing_cycles: [{
      frequency: { interval_unit: 'MONTH', interval_count: 1 },
      tenure_type: 'REGULAR',
      sequence: 1,
      total_cycles: 0,
      pricing_scheme: { fixed_price: { value: p.price, currency_code: 'USD' } },
    }],
    payment_preferences: {
      auto_bill_outstanding: true,
      setup_fee_failure_action: 'CONTINUE',
      payment_failure_threshold: 3,
    },
  }, H());
  plans[p.key] = plan.id;
  console.log(`plan ${p.name} $${p.price} ->`, plan.id);
}

const n = Number(process.argv.find((a) => a.startsWith('--subs='))?.split('=')[1] || PEOPLE.length);
const pending = [];
for (let i = 0; i < n; i++) {
  const who = PEOPLE[i % PEOPLE.length];
  const sub = await ppOrThrow('POST', '/v1/billing/subscriptions', {
    plan_id: plans.full,
    subscriber: { name: { given_name: who.given_name, surname: who.surname }, email_address: BUYER },
    application_context: {
      brand_name: 'Fermata',
      user_action: 'SUBSCRIBE_NOW',
      shipping_preference: 'NO_SHIPPING',
      return_url: 'https://example.com/approved',
      cancel_url: 'https://example.com/cancelled',
    },
  }, H());
  const approve = sub.links.find((l) => l.rel === 'approve').href;
  pending.push({ id: sub.id, name: `${who.given_name} ${who.surname}`, note: who.note, approve });
  console.log(`subscription ${sub.id}  ${who.given_name} ${who.surname}`);
}

await writeFile('data/seed.json', JSON.stringify({
  productId: product.id,
  planIds: Object.values(plans),
  planMap: plans,
  subscriptionIds: pending.map((p) => p.id),
  buyer: BUYER,
  people: Object.fromEntries(pending.map((p) => [p.id, { name: p.name, note: p.note }])),
}, null, 2));

await writeFile('data/approve-links.txt', pending.map((p) => `${p.name}\n${p.approve}\n`).join('\n'));
console.log('\nwrote data/seed.json and data/approve-links.txt');
console.log('\nAPPROVE THESE IN THE BROWSER:');
for (const p of pending) console.log(` ${p.name}: ${p.approve}`);
