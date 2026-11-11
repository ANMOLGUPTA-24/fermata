# Fermata — demo video script

**Target: 2:40. Hard ceiling 3:00 — judges are not required to watch past it.**
Record at 1280x720 or larger. No music (the rules forbid unlicensed audio).
Record against your **local** copy started with `ALLOW_DESTRUCTIVE=true npm run dev`,
so the plan-change step really executes. All four subscribers should be ACTIVE
before you hit record. Do NOT click Execute on "Let them go" — it is permanent.

---

### 0:00 – 0:22 · The problem (talk over the subscriber list)

> "This is a retention desk for a small software business.
> When someone cancels a subscription, almost every product in the world
> treats it as one button and one outcome.
> But 'money is tight this month' and 'this isn't the right tool for me'
> are completely different people.
> One of them you can keep by charging them nothing for sixty days.
> The other you should let go cleanly — because trapping them produces
> chargebacks that cost more than the subscription was worth.
> Today, both press the same button, and both are gone forever."

### 0:22 – 0:35 · What you're looking at

> "These four are live PayPal subscriptions in the sandbox.
> The status, the plan, the price — all fetched from PayPal on every page load.
> The names are our own customer records, joined to PayPal by subscription ID."

*Point at the `PayPal sandbox` and `gemini-flash-latest` badges.*

### 0:35 – 1:05 · The pause decision

*Click Priya. Click the first sample chip: "Money's really tight this month."
Click **Ask Fermata**.*

> "Fermata reads her actual words, pulls her live subscription state from PayPal,
> and then does the part that matters."

*When the ballot appears, pause on it.*

> "This is the key design decision. The server computes which actions PayPal will
> genuinely permit for this subscription right now. The model doesn't get to
> invent an API call — it only gets to **choose** from this menu, and justify it.
> If it returns anything that isn't on the list, the pick is rejected and the case
> goes to a human."

> "And the browser can't cheat either — the server holds the decision, and will
> only execute the one it issued."

> "It chose pause. Not a discount, not a guilt trip. Pause — because the reason
> was temporary, and pausing costs the subscriber nothing."

### 1:05 – 1:30 · Execute, and prove it

*Click **Execute against PayPal**.*

> "And that's a real PayPal call."

*Point at the receipt line.*

> "HTTP 204. ACTIVE to SUSPENDED. That's PayPal's own debug ID.
> Her billing is genuinely paused — you could go and look at it in the
> PayPal dashboard right now."

### 1:30 – 1:55 · It knows when to let go

*Click Marcus (or Tomas). Use the chip: "This isn't the right tool for me."*

> "Now the opposite case."

*Show the verdict.*

> "It chose to let them go, at high confidence — and it says why.
> The engine is explicitly told that releasing someone is a correct outcome.
> A retention tool that can't say goodbye is just a dark pattern with a
> language model attached."

### 1:55 – 2:20 · A plan change takes consent

*Click Tomas. Use the chip: "I'm not using this enough to justify $29."
Ask, then Execute.*

> "When it decides on a downgrade, something interesting happens.
> PayPal doesn't apply a plan change on the merchant's say-so. It hands back an
> approval link for the subscriber — and Fermata surfaces that link rather than
> pretending the job is done."

> "Until they approve, Fermata takes 'pause' off the menu for this subscriber,
> because we found in the sandbox that pausing mid-consent strands the
> subscription. That flag is stored on PayPal itself."

*After recording: open that consent link and click Agree, so Tomas's change
completes and nothing is left pending.*

### 2:20 – 2:40 · Close

*Click **Reset demo**; the board returns to ACTIVE.*

> "Pause and resume are reversible, so the hosted demo can be run as many times
> as you like without using anything up.
> PayPal Subscriptions, Billing Plans and Catalog for the money.
> Gemini for the judgement. Every decision leaves a receipt.
> That's Fermata."

---

## Recording notes

- Cut every loading spinner in the edit. The Gemini call takes 2–8 seconds; it
  should not appear in the video.
- Say the words "PayPal" and "Gemini" out loud — the organisers explicitly
  advise making both impossible to miss.
- An AI voiceover is explicitly allowed if you would rather not narrate.
- Upload to YouTube as **public** (not unlisted) and upload early: processing
  can take hours, and the deadline is hard.
