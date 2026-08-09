# Migration errata — corrections to files in `supabase/migrations/`

Migrations are append-only once applied (project rule #7): a comment that turns out to be
wrong can never be fixed in place, and the file keeps asserting it to everyone who reads it.

Corrections land here. One section per migration, newest first. Each entry names the lines it
supersedes and points at the test that holds the verified behaviour — the test is the source
of truth, this file is the signpost.

It lives one level up from the migrations it annotates: the Supabase CLI treats every file in
`supabase/migrations/` as a candidate migration and prints a "Skipping …" line for anything
that isn't `<timestamp>_name.sql`.

This is not a changelog. Only add an entry when a comment in an applied migration is
**materially misleading** about what the SQL does.

---

## `20260808075738_fund_contribution_failed_status.sql`

### L3-7 + L20-23 — SEPA never stayed live, and PayPal was never a delayed method

The header opens "SEPA Direct Debit went live on the Stripe account" and introduces `'failed'`
as the terminal state for a bounced delayed debit. SEPA was turned off before any of it ran in
anger. The whole delayed-settlement path went with it — `isSettled`, the W1b/W3b/W3c handlers,
and the two `checkout.session.async_payment_*` router cases — so the column `comment` this
migration set describes a state the code can no longer produce.

`0352e4c`'s commit message compounds it by calling **PayPal** a delayed-notification method
alongside SEPA. It is not. Stripe permits only synchronous funding sources on PayPal unless you
ask Support to enable asynchronous ones, so PayPal reports its final outcome on
`checkout.session.completed` exactly as a card does. That is why PayPal stays enabled while
SEPA does not, and why removing the state machine costs nothing.

Superseded by `20260808093013_fund_contribution_drop_failed_status.sql`, which retires any
surviving `'failed'` row to `'refunded'`, restores the original three-status CHECK, and
rewrites the column comment. Asserted in
`supabase/tests/0078_fund_contribution_drop_failed_status.test.sql`: `'failed'` now raises
`23514`, the three surviving statuses still insert, and the column DEFAULT is still one of them
— which is the reason `'pending'` was kept rather than removed alongside `'failed'`.

The replacement is fail-closed rather than absent. `assertSettled`
(`supabase/functions/stripe-webhook/handlers.ts`) throws on any session whose `payment_status`
is neither `paid` nor `no_payment_required`, and the two `async_payment_*` event types throw
instead of falling through to a silent 200. Nothing in this repo selects payment methods — the
`create-*` builders pass neither `payment_method_types` nor `payment_method_configuration` — so
the Stripe Dashboard is the only control. Re-enabling a delayed rail there produces a 500, a
Stripe retry, and a `stripe_webhook_events` row stuck at `processed_at is null`, instead of a
signed QR for money that has not arrived. Reviving delayed settlement means restoring
`0352e4c`'s state machine, not deleting the guard.

---

## `20260808035852_momenti_suggestion_rpc.sql`

### L58 + L66 — "newest member" was really "most recently touched profile"

The function ordered by `p.updated_at desc` and the header (and `comment on function`)
described that as the "newest member". `profiles_touch_updated_at` fires on every profile
UPDATE, and server-side writes bump it too — `identity_verified` from the Stripe Identity
webhook, `founding_member`, `push_enabled`, `referral_code`. A two-year-old account that edited
its bio a minute ago sorted first.

Superseded by `20260808041335_momenti_suggestion_rpc_ordering.sql`, which ranks by the newest
active **dream** instead — the signal the row actually displays, and the one the «Sogno nuovo»
chip claims. Ordering is asserted in `supabase/tests/0075_momenti_suggestion_rpc.test.sql`,
where every filtered-out candidate deliberately holds a newer dream than the expected winner.

### L6 — "they leave every deck"

One-directional, same overstatement corrected below for `20260807174758`. A member who hides
both tag fields leaves every **other** member's deck; they still receive one of their own,
scored against their own private tags.

---

## `20260807174758_m10_visibility_followups.sql`

### L23-26 — the Momenti privacy trade is neither total nor triggered by one field

The product note says a member who marks `identity_tags` private "scores affinity 0 against
everyone and therefore drops out of Momenti matching entirely". Both halves are wrong.

**It takes both tag fields, not one.** Affinity sums three terms (L90-92):

```
shared    = recipient.identity_tags ∩ candidate.identity_tags
seek_hit  = recipient.seeking       ∩ candidate.identity_tags
offer_hit = recipient.identity_tags ∩ candidate.seeking
```

`identity_tags` and `seeking` are masked by **independent** predicates (L95-98). Hiding
`identity_tags` alone empties the first two terms but leaves `offer_hit` live, so the member
keeps matching anyone whose identity tags meet their still-visible `seeking`. Affinity only
reaches 0 when **both** fields are private.

**And it is one-directional.** The masking applies to the **candidate** side only; the
`recipients` CTE reads `p.identity_tags` and `p.seeking` **raw** (L77). A member with both
fields private therefore:

- **does** disappear from everyone else's deck, and
- **still receives** a deck of their own, scored against their own private tags.

All three cases are asserted next to each other in
`supabase/tests/0073_visibility_followups.test.sql`: both-private ⇒ no match, `identity_tags`
alone ⇒ still matched via `offer_hit`, and the recipient direction.

The recipient direction leaks nothing _to the candidate_: the derived `reasons` never leave the
recipient's own row (`momento_proposals_select_own`,
`20260619222420_m9_blocks_and_not_blocked.sql:108-111`). Read that narrowly — it is a statement
about who can see the row, not about what the row says. `reasons` is a match-time snapshot
naming the candidate's raw tag keys, and it survived the candidate later hiding those tags;
`20260807201350_purge_stale_momento_proposals.sql` closes that case by deleting the pending
proposals on the flip.

### L18-21 — Realtime does filter payload columns by privilege

The header says Realtime "applies row RLS but not column privileges", and presents the
publication column list at L172-174 as the control that closes the hole.

The installed `realtime.apply_rls` **does** filter payload columns by `has_column_privilege`.
The primary control is therefore the column-scoped `grant` in
`20260807170813_m10_profile_visibility_enforcement.sql:66-68`; the publication column list is
defense-in-depth on the same door.

Asserted in `supabase/tests/0073_visibility_followups.test.sql` (the realtime publication
check, with the accurate note beside it).

---

## `20260701124122_m6_aura_award_triggers.sql`

### L38-39 — `post_starred (+2)` is wrong twice over

The section header reads:

```sql
-- 3. post_starred (+2): a ✦ from a member whose Aura > 300 (REACTION_AUTHOR_MIN_SCORE,
--    packages/core weights.ts) → award the post author. Never self-award.
```

`+2` is not the award. `ENGINE_WEIGHTS.POST_REACTION` is a **base** that `pointsFor` multiplies
by `reviewerWeight(reactor score) = min(2, 1 + ln1p(s/1000))` before rounding, and the gate is
`s > 300`. The lowest reactor who clears the gate already weighs ≈1.263, so the reachable band
is **{3, 4}** — 3 from a reactor at 301, 4 from 1118 up. 2 is unreachable. The same wrong number
stood in `packages/core/src/score/weights.ts` and PRD §4.9; both were corrected 2026-08-09.

And in the shipped system the award is neither 2 nor 3–4 but **0**. This trigger selects
`v_reactor_score`, gates on it in SQL, and then calls `athanor.enqueue_score_award(...)` — which
has no parameter for it. The `pg_net` body carries only `severity`, so `score-engine`'s
`awardCtx` reaches `pointsFor` with `reviewerScore` undefined, `?? 0` fails the gate a second
time, and the function returns `{awarded: 0, skipped: true}` with no `aura_events` row. The gate
is written twice and the second copy always loses. Tracked as **issue #27**; fixing it needs a
new migration (append-only) that plumbs the score through the enqueue payload.

Verified behaviour lives in two places. `packages/core/src/score/award.test.ts` holds the `{3, 4}`
band across the whole qualifying range plus `pointsFor('post_starred', {})` → `0`, which pins the
_consequence_ — but it is required to keep passing after #27 lands, so it can never announce the
fix. `supabase/tests/0064_aura_award_triggers.test.sql` therefore also asserts that no
`enqueue_score_award` overload carries a reactor-score parameter: that one goes red the moment the
plumbing arrives, which is what forces this entry and the `weights.ts` comment to be corrected in
the same change rather than drifting a third time. Delete it with #27.

Note also that `300` is written as a SQL literal at L49 rather than derived
from `REACTION_AUTHOR_MIN_SCORE`, so the two copies of the threshold can drift (rule #10).
