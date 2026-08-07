# Stripe money paths

Type: research
Status: open

## Question

Are the Stripe money paths tested, and at what fidelity?

Rule 6: money state is a cache of Stripe webhooks; Stripe is source of truth; webhooks are
signature-verified and deduped on `stripe_webhook_events.event_id`. Recent commits `c1c40f2` and
`209b15e` reworked the webhook claim into an atomic conditional UPDATE with a `claimed_at` lease,
and `04a3132` documents a hard-crash window.

Determine:
- Is the dedupe/claim logic tested — including the at-least-once redelivery path, the lease
  expiry, and the documented hard-crash window?
- Is signature verification tested, including the **rejection** case?
- Which of Checkout (tickets, fund), Billing (Circle), and Identity (verification) have tests
  covering failure modes, not just the happy path?
- How is Stripe faked — hand-rolled stub, recorded fixtures, or `stripe-mock`? Is the fake
  pinned to a Stripe API version, and does it drift from the real one?
- Consult the `stripe:stripe-best-practices` skill for what a well-tested integration asserts,
  and name what is missing here.
