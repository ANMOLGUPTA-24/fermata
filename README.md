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

**The model never invents a PayPal call.**

The server computes the permitted action set from real subscription state. The
model may only *select* from that menu. If it returns anything else, the pick is
rejected and the case is escalated to a human — you can see this path in
`src/engine.js`. A hallucinated action is not merely discouraged; it is
unrepresentable.

The UI renders that menu as a ballot, so you can see exactly what the model was
allowed to choose from and what it picked.

## It cannot silently move anyone's money

PayPal will not let a merchant change a subscriber's price without the
subscriber's consent. When Fermata decides on a downgrade, PayPal returns an
approval link rather than applying the change, and Fermata surfaces that link
instead of pretending the job is done. This is enforced by the payment rails,
not by our good intentions.

The retention prompt also explicitly instructs the model that **"release" is a
correct outcome** and that retaining someone against their will is more expensive
than losing them.

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
git clone <this repo>
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

- "Reset demo" returns every subscriber to `ACTIVE`.
- The headline actions (pause / resume) are **reversible**, so the demo cannot be
  used up. "Let them go" is irreversible and is the only destructive path.
- Every executed action appears in the receipts panel with the real PayPal HTTP
  status, the status transition, and PayPal's `debug-id`.

To approve a new subscription in your own copy, log in at the approval link with
the sandbox buyer account printed by `npm run seed`.

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
