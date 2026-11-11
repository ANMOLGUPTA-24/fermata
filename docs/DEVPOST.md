# Devpost submission copy

## Tagline (one line)
A cancellation is a negotiation, not a button — AI retention decisions executed as real PayPal subscription actions.

---

## Inspiration

For a small software business, cancellation is one button, and everyone who
presses it is treated identically. But "money is tight this month" and "this
isn't the right tool for me" are completely different people. One of them you
could keep by charging them nothing for sixty days. The other you should let go
cleanly, because trapping someone produces chargebacks and disputes that cost
far more than the subscription earns.

Today both get the same confirmation screen, and both are gone forever. That
asymmetry is where the money is, and nobody is standing in it.

## What it does

Fermata is a retention desk. When a subscriber signals they want to leave, it:

1. Reads what they actually said — a support ticket, a cancel reason, an email.
2. Pulls **live** state from PayPal: status, plan, failed payment count,
   outstanding balance, billing history.
3. Computes the set of actions PayPal will genuinely permit for that
   subscription at that moment, from PayPal's own state machine.
4. Asks Gemini to choose one and justify it with cited evidence.
5. Executes the choice as a real PayPal API call, and records a receipt showing
   the HTTP status, the state transition, and PayPal's debug ID.

Pause the billing. Move them to a cheaper plan. Resume them later. Or let them
go gracefully.

## How we built it

- **PayPal Subscriptions, Billing Plans and Catalog Products** are the spine —
  not a checkout button bolted onto the side. Suspend, activate, revise, cancel
  and the transactions endpoint are all driven directly.
- **Google Gemini** (`gemini-flash-latest`) makes the decision, using structured
  output with a response schema so the verdict is a typed object rather than
  prose to be parsed.
- **No dependencies.** The server is Node's standard library only, so there is
  no install step and nothing in the tree can rot before judging.
- **No database.** PayPal is the source of truth; the app holds only a registry
  of subscription IDs. That also means an ephemeral filesystem can't hurt it.

## The design rule we're proudest of

**The model never invents a PayPal call.**

The server computes the permitted action set. The model may only *select* from
that menu. If it returns anything else, the pick is rejected and the case is
escalated to a human — and the UI renders the menu as a ballot, so you can see
exactly what it was allowed to choose from and what it picked.

A hallucinated payment action isn't merely discouraged here. It's unrepresentable.

## It cannot silently move anyone's money

PayPal will not let a merchant change a subscriber's price without the
subscriber's consent. When Fermata decides on a downgrade, the API returns an
approval link rather than applying the change, and Fermata surfaces that link
instead of pretending the job is done.

That guarantee is enforced by the payment rails, not by our good intentions. And
the retention prompt explicitly instructs the model that **"release" is a correct
outcome** — a retention tool that cannot say goodbye is just a dark pattern with
a language model attached.

## Challenges we ran into

**Indian sandbox accounts can't do subscriptions.** Our first merchant account
was created in India, and every subscription approval died on a generic PayPal
error. The billing-agreement flow that subscriptions depend on isn't supported
for IN accounts. Rebuilding on US sandbox accounts fixed it. It's written up in
the README so the next person loses zero hours to it.

**`revise` stages a change; it doesn't make one.** It returns an approval link,
and until the subscriber approves, the subscription carries hidden pending state.
A subscription paused in that state cannot be reactivated —
`SESSION_STATE_NOT_VALID: "Buyer has not agreed to subscription"` — and it can't
be revised back either, because revise is rejected once the status is SUSPENDED.

Worse, **PayPal does not expose this state**. We compared a pending subscription
against a clean one field by field: identical shape, identical links, identical
`plan_id`. So Fermata tracks outstanding consent itself and flatly refuses to
pause a subscription that has one, and `reset` explains the stranded case in
plain language instead of surfacing a bare 422. We found this by stranding a
test subscriber and having to replace them.

## What we learned

That the interesting constraints in payments are the ones the API enforces on
*you*. We set out to let an agent manage subscriptions, and PayPal kept saying
"not without the human's consent." Rather than route around that, we made it the
product's spine — and it turned out to be the most defensible thing about it.

## What's next

Webhook-driven triggers (`BILLING.SUBSCRIPTION.PAYMENT.FAILED`) so involuntary
churn is caught before the subscriber ever writes in; outcome tracking to learn
which interventions actually hold; and per-merchant policy so the permitted
action set reflects the business's own rules, not ours.

## Built with

`paypal-subscriptions-api` `paypal-billing-plans` `paypal-catalog-products`
`paypal-rest-api` `paypal-sandbox` `google-gemini` `gemini-flash` `node.js`
`javascript` `html` `css` `zero-dependency`

---

## Testing instructions (paste into the submission form)

The hosted demo is seeded with four live PayPal sandbox subscriptions and carries
its own credentials — nothing needs to be configured to try it.

1. Pick a subscriber.
2. Click one of the sample cancellation messages, or write your own.
3. Click **Ask Fermata** — it reads live PayPal state and returns a decision
   with the action menu it was constrained to.
4. Click **Execute against PayPal** — the receipts panel shows the real HTTP
   status, the state transition, and PayPal's debug ID.
5. Click **Reset demo** to return every subscriber to ACTIVE.

Pause and resume are reversible, so the demo cannot be used up. "Let them go" is
the only irreversible action.

To run it locally against your own sandbox, see the README — note the warning
about using a **US** sandbox business account.
