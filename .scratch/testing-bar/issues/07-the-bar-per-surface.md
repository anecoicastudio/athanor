# The bar per surface

Type: grilling
Status: open
Blocked by: 01, 02, 03, 04, 05, 06

## Question

What is the testing bar for each surface, and is it the same bar everywhere?

The gap ledger from tickets 01–06 makes this answerable. The decision is not "90% everywhere" —
the surfaces differ in kind: pure domain logic, typed plumbing, RN UI, privileged Deno functions,
RLS policies, and money paths that must never silently drift from Stripe.

Settle: the bar per surface, what evidence counts as meeting it (line coverage, behavioural
assertions, negative-path assertions), and which surfaces get a stricter bar because a failure
there is unrecoverable rather than merely annoying.
