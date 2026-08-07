# Edge function tests

Type: research
Status: open

## Question

After the `logic.ts` extraction, which of the 14 edge functions are genuinely tested?

Commit `f1e21ba` extracted testable `logic.ts` from 9 `index.ts` shells and grew a fake-db;
16 test files now exist across 14 functions. File count is not coverage.

Determine, per function (`check-in`, `create-circle-checkout`, `create-circle-portal`,
`create-contribution-session`, `create-ticket-checkout`, `create-verification-session`,
`erasure-job`, `gdpr-export-job`, `media-process`, `notification-fan-out`, `push-dispatch`,
`score-engine`, `stripe-webhook`):
- Is there a `logic.ts` with tests, or is the logic still in an untested `index.ts` shell?
- Is `score-engine` — the only writer of `aura_events`/`aura_scores` — tested against the
  weights in `packages/core`, including the zero-points rules?
- Are the 5 functions *not* covered by the extraction identified, and why were they skipped?
- Is `verify_jwt = true` asserted anywhere for all functions except `stripe-webhook` (rule 8)?
- Is `profile_id` always derived from `getUser()` and never from the request body (rule 8)?
