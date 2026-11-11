# Fermata

**A cancellation is a negotiation, not a button.**

Fermata is a retention desk for small subscription businesses. When a subscriber
signals they want to leave, it reads the signal against their live PayPal
subscription state, decides the cheapest *honest* intervention, and executes it
as a real PayPal API action — pause the billing, move them to a cheaper plan,
resume them later, or let them go gracefully.

Built for the **PayPal AI Hackathon** (Nov 2026).

---

## The problem

For a small software business, cancellation is a single button, and everyone who
presses it is treated identically. But "money is tight this month" and "this isn't
the right tool for me" are completely different people. One of them you can keep
by charging them *nothing* for 60 days. The other you should let go cleanly,
because trapping them produces chargebacks that cost more than the subscription.

Today both get the same cancel confirmation, and both are gone forever.

## What Fermata does

1. Reads the subscriber's actual words (support ticket, cancel reason, email).
2. Pulls **live** subscription state from PayPal — status, plan, failed payment
   count, outstanding balance, billing history.
3. Computes the set of actions that are *legally permitted* for that subscription
   right now, derived from PayPal's own state machine.
4. Asks Gemini to choose one and justify it with cited evidence.
5. Executes the choice as a real PayPal call, and records a receipt.

## The design rule that matters

**The model never invents a PayPal call, and neither can the browser.**

The server computes the permitted action set from real subscription state. The
model may only *select* from that menu; if it returns anything else, the pick is
rejected and the case is escalated to a human (`src/engine.js`).

The decision is then stored server-side under a single-use verdict id.
`/api/execute` accepts only that id — never an action name — so a client cannot
ask for something the engine did not decide, replay a decision, or act on a
subscription outside the seeded set (`src/server.js`).

The UI renders the menu as a ballot, so you can see exactly what the model was
allowed to choose from and what it picked.

## Changing someone's plan takes their consent

When Fermata decides on a downgrade, `POST .../revise` does not apply it. PayPal
returns an approval link for the subscriber, and Fermata surfaces that link
instead of pretending the job is done.

To be precise about what is and is not enforced: this consent step applies to
moving a subscriber to a **different plan**. PayPal *does* let a merchant PATCH a
subscription's price from the server without approval — we tested it and it
returns 204. Fermata simply never puts that on the menu. The restraint there is
ours, by design, not PayPal's.

The retention prompt also instructs the model that **"release" is a correct
outcome**, and that retaining someone against their will costs more than losing
them.

## PayPal APIs used

| Capability | Endpoint |
|---|---|
| Catalog products | `POST /v1/catalogs/products` |
| Billing plans | `POST /v1/billing/plans`, `GET /v1/billing/plans` |
| Subscriptions | `POST /v1/billing/subscriptions`, `GET /v1/billing/subscriptions/{id}` |
| Pause billing | `POST /v1/billing/subscriptions/{id}/suspend` |
| Resume billing | `POST /v1/billing/subscriptions/{id}/activate` |
| Change plan | `POST /v1/billing/subscriptions/{id}/revise` |
| End subscription | `POST /v1/billing/subscriptions/{id}/cancel` |
| Retry an unpaid balance | `POST /v1/billing/subscriptions/{id}/capture` |
| Durable consent flag | `PATCH /v1/billing/subscriptions/{id}` (`custom_id`) |
| Billing history | `GET /v1/billing/subscriptions/{id}/transactions` |
| OAuth2 | `POST /v1/oauth2/token` |

All against the **PayPal sandbox**. No real money moves.

## AI

- **Model:** Google Gemini (`gemini-flash-latest`), via the Generative Language API.
- **How it is used:** structured JSON decision-making with a response schema, so
  the verdict is a typed object, not prose to be parsed.
- **Resilience:** if the free tier is rate-limited or the alias is unavailable,
  the client falls back to `gemini-3.1-flash-lite` automatically, so the demo
  keeps working. See `src/ai.js`.
- The model receives live PayPal state and a computed action menu. It returns a
  choice, a confidence, cited evidence, and a message written for the subscriber.

## Run it yourself

Requires Node 20+. No dependencies to install — the server is standard library only.

```bash
git clone https://github.com/ANMOLGUPTA-24/fermata.git
cd fermata
cp .env.example .env
#   PAYPAL_CLIENT_ID / PAYPAL_SECRET  -> developer.paypal.com > Apps & Credentials > Sandbox
#   GEMINI_API_KEY                    -> aistudio.google.com/apikey  (free tier is enough)

npm run smoke     # proves your credentials work and prints which PayPal APIs you can reach
npm run seed      # creates the product, two plans, and four subscriptions
#                   then open each printed approval link and click "Agree & Subscribe"
npm start         # http://localhost:3000
```

### Important: use a **US** sandbox business account

PayPal routes subscription approval through a billing-agreement flow that Indian
sandbox accounts do not support — the checkout fails with a generic error. Create
US sandbox Personal and Business accounts under **Testing Tools > Sandbox
Accounts**, then create your REST app against the US business account.
This cost us an hour; it is written down so it costs you nothing.

## Testing notes for judges

The hosted demo is already seeded with four live sandbox subscriptions and
carries its own credentials, so **nothing needs to be configured to try it**.

- Billing state — status, plan, price, balances — is fetched live from PayPal.
  The subscriber names and notes are the merchant's own customer records
  (`data/seed.json`), joined to PayPal by subscription id, as they would be in a
  real business. PayPal itself knows all four as the same sandbox buyer.
- **Pause and resume execute for real** and are reversible. "Reset demo" resumes
  anything paused.
- **Cancelling and plan changes are decided but not executed on the shared
  demo.** One is irreversible and the other stages a consent request only the
  subscriber can clear, so an anonymous visitor could otherwise use the demo up
  for everyone. Both run for real locally with `ALLOW_DESTRUCTIVE=true npm run dev`
  — the code path is identical.
- Every executed action appears in the receipts panel with the real PayPal HTTP
  status, the status transition, and PayPal's `debug-id`.
- The free host sleeps when idle, so the first load can take up to a minute.

To approve subscriptions in your own copy, log in at each approval link with a
sandbox Personal (buyer) account from your own developer dashboard.

## Layout

```
src/paypal.js         OAuth token cache + the single function every PayPal call goes through
src/subscriptions.js  Subscription lifecycle adapter, 1:1 with PayPal endpoints
src/engine.js         Permitted-action computation + the model's constrained choice
src/ai.js             Gemini client, structured output, quota fallback
src/server.js         Zero-dependency HTTP server and JSON API
src/seed.js           Creates the sandbox catalogue; writes data/seed.json
src/smoke.js          Credential and capability probe — run this first
public/index.html     The retention desk
```

## Licence

MIT — see [LICENSE](LICENSE).

## A PayPal behaviour worth writing down

*Observed in the PayPal sandbox, November 2026.*

`POST /v1/billing/subscriptions/{id}/revise` does not apply a plan change. It
*stages* one and returns an approval link for the subscriber. Until they approve
it, the subscription carries hidden pending state, and in our testing:

- `POST .../activate` on a paused subscription failed with
  `SESSION_STATE_NOT_VALID` — *"Buyer has not agreed to subscription"*. It was
  still failing hours later.
- `POST .../revise` failed with `SUBSCRIPTION_STATUS_INVALID` once the
  subscription was `SUSPENDED`, so it could not be undone from the server.

A subscription paused while a revision is pending was therefore stranded until
the subscriber acted. And the pending state is **not visible in the API**: we
compared a pending subscription against a clean one and found the same fields,
the same links and the same `plan_id`.

So Fermata records an outstanding consent request itself, in the subscription's
`custom_id` on PayPal — which survives a restart, unlike process memory — and
removes "pause" from the menu while it is outstanding. `reset` reports a
stranded subscription in plain language rather than a bare 422. We found this
the expensive way, by stranding a test subscriber and having to replace them.
