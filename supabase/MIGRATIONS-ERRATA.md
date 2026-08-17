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

## `20260816153011_fund_confirmed_counts_service_role.sql:1-9` — the 42501 it names is reachable on a hosted project only, never in a clean replay

The header says a service-role `select … from public.fund_candidate_cards` "failed outright
with «permission denied for function dream_confirmed_counts»". That is exactly what happened —
on **staging**, and it cannot happen in a database built from these migrations.

Nothing grants `service_role` SELECT on that view. `20260618131250_m7_voting.sql:158-159`
revokes from `anon` and grants to `authenticated`, and no later migration widens it. So in
CI's replay-from-zero the read stops at the VIEW (`permission denied for view
fund_candidate_cards`) and never reaches the function whose grant this migration adds.

The reason staging disagreed is grant drift: a hosted Supabase project answers
`has_table_privilege('service_role', 'public.fund_candidate_cards', 'select')` = **true**
even though no migration says so. CI cannot see that drift, which is why the pgTAP assertion
written against staging's behaviour passed there and failed in CI on the same commit.

**What the migration DOES is still correct and still wanted.** Wherever `service_role` can
reach the view — every hosted project today, production included — the view's `LEFT JOIN
LATERAL` makes EXECUTE on `athanor.dream_confirmed_counts` a precondition for reading _any_
column of it, so without this grant a privileged read on a hosted project really does raise 42501. Only the "how it was found" framing is misleading: read it as a hosted-projects fix,
not as something a fresh database exhibits. The second half of the migration (dropping the
in-body `auth.uid() is not null` clause) stands on its own reasoning, which the file states
correctly: `athanor` is not an exposed schema and EXECUTE is revoked from `public`/`anon`, so
the grant is the gate.

Asserted by: `supabase/tests/0045_fund_candidate_cards_view.test.sql`, which asserts the
PRIVILEGES rather than performing a read whose outcome depends on which database it runs in.

**Amended by #409.** That file used to assert `service_role` has **no** SELECT on the view —
true in a from-zero replay, false on every hosted project, so the file failed by one assertion
whenever it was smoke-run against staging. #409 ruled the drift **accepted** (it is not local
to this view: `service_role` holds the full `arwdDxtm` set on all 59 objects in `public`, from
`pg_default_acl` rows one of which no migration can rewrite, and the role bypasses RLS by
definition), so an assertion a hosted project must fail was asserting a fiction. It is replaced
by the client surface, which answers the same in both worlds: `anon` cannot read the view,
`authenticated` can. The `service_role` EXECUTE assertion on the aggregate stands — that one is
declared by `20260816153011` and holds everywhere. What remains environment-dependent is the
file's own fixtures, which collide (`23505`) with staging's seeded active edition; that is a
seed collision, not a grant fact.

---

## `20260816073905_fund_realization_plans.sql:37-38, 234` — "nothing here writes a plan except the service role" was the deferred decision, not the answer

The header's SEAMS LEFT OPEN paragraph and the RLS section's "#229 writes as `service_role`"
read as a statement about how plans are written. They were a _placeholder_: #228 deliberately
shipped no write path and left the choice to #229, which chose the opposite one.

`20260816082552_fund_plan_authoring.sql` gives the **winner** the write path directly:
column-level INSERT/UPDATE grants plus `*_own_draft` policies, scoped to their own candidacy
and to `published_at is null`. `published_at` and `realization_plan_phases.verified_at` are
granted to nobody, so publication stays `publish_realization_plan()` and verification stays
#231's. The service role can still write everything; it is simply no longer the only writer.
Both `comment on table` values were replaced in that migration, so the DB objects describe
the current shape — only the file's prose is stranded.

The same migration's `close_cycle` siblings are stranded the same way and in the same
direction: `20260815193158:203-205` and `20260815215924:204-206` say "nothing enters
`'realization'` until #228's plan transition, so `'announcement'` with a confirmed winner is
the working window for cycle 1". That transition now exists — `publish_realization_plan()`
moves the cycle to `'realization'` as it publishes — so the _until_ has arrived. The phase
guard itself is unchanged and still correct: both phases remain closeable.

Verified behaviour lives in `supabase/tests/0115_fund_plan_authoring.test.sql` (the winner
drafts as a client, the ceiling refuses a client, publication stamps `published_at` **and**
moves the cycle to `'realization'`, and every client write is refused afterwards) and in
`0114_fund_realization_plans.test.sql`'s policy catalogue.

---

## `20260816073905_fund_realization_plans.sql:138-229` — both plan triggers were `SECURITY INVOKER` and could not survive a client writer

`realization_plans_binds_winner()` and `realization_plan_phases_within_payable()` both read
`public.fund_editions … FOR UPDATE`. `SELECT … FOR UPDATE` requires the **UPDATE** privilege
on the locked table, which no client has on `fund_editions` and none should — so as written
the guards raised a bare `42501: permission denied for table fund_editions` for the very
writer #229 made legitimate, before either could reach one of its own named refusals.

`20260816083454_fund_plan_trigger_privileges.sql` replaces both with `SECURITY DEFINER`
(bodies otherwise verbatim, `search_path` still locked). That also closes a latent hole in
the second one: an INVOKER guard sums the plan's other phases under the **caller's** RLS, so
a writer who could not see a sibling row would compute a smaller sum and pass a ceiling that
is the whole point of the trigger.

Verified behaviour lives in `supabase/tests/0115_fund_plan_authoring.test.sql` — the client
insert lands, and the ceiling refuses a client with `phases exceed declared payable` rather
than a privilege error.

---

## `20260815205504_payout_accounts.sql:9-10` — "Written ONLY by the stripe-webhook `account.updated` branch" is one writer short

The header (and the `comment on table` at L30, plus "The webhook writes as `service_role`" at
L51) names the webhook as the table's only writer. The **initial row** is written by
`create-payout-onboarding` (#246): reuse semantics need a durable
`{profile_id, stripe_account_id}` pointer at account-creation time — waiting for the first
`account.updated` event would leave a window in which a retry mints a second Express account
for the same profile. So the function inserts the pointer row through the service-role client
(the table's SRW posture is unchanged — clients still have no write path), and the webhook
remains the only writer of the **state** columns (`charges_enabled`, `payouts_enabled`,
`onboarded_at`).

Verified behaviour lives in `supabase/functions/create-payout-onboarding/logic.test.ts` (the
insert carries only the two pointer columns; the 23505 race re-reads the winner) and
`supabase/functions/stripe-webhook/handlers.test.ts` (W13 — flags both directions,
`onboarded_at` set-once, unmatched account acked). Client denial is unchanged and stays
asserted by `supabase/tests/0111_payout_accounts_rls.test.sql`.

---

## `20260815183252_fund_announcement.sql:22-27` — "the pool only grows" is false

The header's composition argument — voters fixed at ballot close **and the pool only
grows**, so a cycle that passed `enter_announcement()`'s checks can never be refused by
`declare_winner()`'s — overstates half of its premise. `reverseContribution`
(`stripe-webhook/handlers.ts`, on `charge.refunded` / dispute) flips a `fund_contributions`
row from `'succeeded'` to `'refunded'` at any moment, with no phase gate, so the settled sum
can shrink between any two reads. The voters half stands: votes have no reversal path.

`20260815185445_fund_announcement_refund_consistency.sql` replaces both functions to
survive this: `enter_announcement`'s void branch also retires a pre-declared `'winner'`
row, and `declare_winner`'s floor check reads `confirmed_pool_cents` once the snapshot
exists (D34's basis) instead of the live sum.

Verified behaviour lives in `supabase/tests/0109_fund_announcement.test.sql` — edition 5
(declare → refund → entry voids, winner retired), edition 6 (announce → refund →
declaration still lands on the snapshot).

---

## `20260616123408_conversations_messages.sql:57` — "NULL for system/prompt" is no longer the whole truth

The inline comment on `messages.sender_id` (`-- NULL for system/prompt`) described the only
null-sender shape that existed at the time. Since `20260813163902_messages_user_shape_deleted_sender.sql`
(#336) a **user**-kind message may also carry a null sender: it is the deleted-member shape the
column's own `on delete set null` action produces mid-erasure-cascade. The original
`messages_user_shape` CHECK contradicted that FK action and aborted every profile hard-delete
with 23514; the widened CHECK admits it, while RLS (`messages_insert_own_user`) still forces
`sender_id = auth.uid()` on every client insert.

Verified behaviour lives in `supabase/tests/0097_messages_deleted_sender_shape.test.sql` —
the SET NULL write passes, the hard-delete completes, clients still cannot forge the shape.

---

## Five migrations — "no-op until the `app.settings.*` GUCs are set" was never a reachable state

Each of these describes its `pg_net` caller as dormant pending a deploy step that sets custom
GUCs on the hosted database:

| migration                                            | stale claim                                               |
| ---------------------------------------------------- | --------------------------------------------------------- |
| `20260617110200_score_engine_cron.sql` L1-2          | no-op until `app.settings.score_engine_url`/`_key` set    |
| `20260617083714_push_enqueue.sql` L2                 | no-op until `app.settings.push_dispatch_url`/`_key` set   |
| `20260622142310_m9_admin_moderation.sql` L4          | no-op until `app.settings.score_engine_*` set             |
| `20260701160235_m9_notification_producers.sql` L6-8  | no-op until `app.settings.notification_fanout_url`/`_key` |
| `20260703154523_p2_2_media_process_enqueue.sql` L6-7 | inert until the P1.1 deploy                               |

That deploy step never existed. On hosted Supabase, supautils rejects
`alter database … set` / `alter role … set` for custom parameters (SQLSTATE 42501), so the
GUCs these comments wait for **cannot be set at all** — the callers were unreachable, not
"pending a deploy". The correcting fact lives in `20260810103721_pg_net_config_via_vault.sql:3-13`:
configuration resolves through **Vault** via `athanor.runtime_setting()`, and the GUC branch
that survives inside that function exists solely for the local CI stack and pgTAP fixtures.

Verified behaviour lives in `supabase/tests/0084_runtime_setting_vault.test.sql` — the
GUC-wins-when-set branch and NULL-when-unconfigured. The Vault half is deliberately not
asserted there (the ephemeral CI stack has no populated `vault.decrypted_secrets`); it is
exercised on the hosted projects, where the live backend depends on it.

---

## Seven `TODO(M9)` markers and three "strip deferred" comments — all closed, none live

An open TODO on a security predicate reads as a live visibility hole, and every audit re-traces
all of them. None is open.

**The blocks/visibility markers**, each closed by a later migration:

| marker                                                                      | closed by                                                |
| --------------------------------------------------------------------------- | -------------------------------------------------------- |
| `20260614203046_post_media.sql:37` — mirror visibility/blocks               | `20260808151808_storage_not_blocked_predicate.sql:22-25` |
| `20260614204000_moments.sql:39` — mirror momenti visibility/blocks          | same file, `:30-33`                                      |
| `20260614230531_story_segments.sql:48` — `is_visible_to_me` / `not_blocked` | same file, `:38-41`                                      |
| `20260616153035_connection_requests.sql:18,146,155,172` — 4× `not_blocked`  | `20260703152310_p2_3_connections_not_blocked.sql:2`      |

**The server-side metadata-strip deferrals** — `20260614230533_story_storage_bucket.sql:4`,
`20260614230531_story_segments.sql:7` and `20260614204500_storage_media_buckets.sql:5` all
call the strip "deferred defense-in-depth" / a "launch-blocker TODO". It shipped:
`supabase/functions/media-process/strip.ts` strips EXIF/GPS/XMP/IPTC and rewrites every MP4
`udta`/`meta` box, and the `media_process_enqueue` trigger
(`20260703154523_p2_2_media_process_enqueue.sql:47`) fires it for the user-media buckets. The
client-side passthrough for video (`apps/native/src/lib/media/process.ts`) is by design — the
server is the backstop.

Verified behaviour: `supabase/tests/0050_not_blocked_predicate.test.sql` holds the predicate
itself and the storage RLS tests (`0014`, `0017`, `0043`) its bucket applications;
`supabase/functions/media-process/strip.test.ts` and `buckets.test.ts` hold the strip and the
trigger/allowlist agreement.

---

## `20260615145423_event_live_stats.sql`

### L2, L12 — "public read for published events" was never what the policy enforced

The header comment and the `comment on table` both claim _"public read for published
events"_, but the policy the file actually creates (`event_live_stats_select_all`,
L24-27) is `using (true)`: world-readable, no reference to `events.deleted_at`. Any
anon or authenticated caller holding a soft-deleted event's id could read its live
stats. The original pgTAP (`0023_event_live_stats_rls.test.sql`) asserted only the
policy's _name_, never its predicate, which is how the gap survived.

Fixed by `20260813055846_event_live_stats_published_only_read.sql` (#137), which
replaces the policy with `event_live_stats_select_published` — an `exists` against
`events` filtering `deleted_at is null`, publication's one definition (there is no
draft flag). `0023` now asserts the predicate: a soft-deleted event's stats row is
invisible to both roles.

## `20260811091835_equal_vote_weight.sql`

### L20-23 — "not a live bug … the Aura engine is dormant" was false when written

The header argues the change is pre-emptive: _"Not a live bug — every weight is 0 today because the
Aura engine is dormant, so the fallback yields the count share… The day the engine's Vault secrets
are set, the displayed consensus would change meaning with no code change"_.

The engine was **already live** when that was written. Production carries all 8 Vault secrets and 5
cron jobs including `aura-nightly-decay`; staging had produced 3 `aura_events` and held 3
`aura_scores` rows against 14 profiles. The premise came from an earlier survey that read the
absence of rows on production as an unconfigured engine — production is empty because it was
replayed from zero on 2026-08-10, not because nothing runs.

What was actually true at that moment on staging: 7 votes, all at `0.000`, the active edition in the
`community` phase, and **all 3 scored members yet to vote** (scores 50, 50, 50). Because
`consensusPercent` switches to the weighted share as soon as `sumWeighted` is non-zero, the first of
those three to vote would have taken **100%** of the displayed consensus while the other seven
ballots read 0%. One vote away, not one deploy away — and the failure total rather than
proportional.

The migration's SQL is correct and unaffected; only its justification was wrong, and it understated
the urgency rather than overstating it.

That header also says nothing about existing rows, because it did not backfill —
`20260811094524_equal_vote_backfill.sql` closes that.

### L37-39 — "an enforced invariant" was, at the time, only true on a fresh database

Both this file and `20260811094524:56-58` claim _"pgTAP 0044 asserts every stored weight is exactly
1.000, which turns this from a convention into an enforced invariant."_ A passing test is not a
constraint. Those two migrations guarded only the INSERT path (the BEFORE INSERT trigger); nothing
guarded UPDATE, and `20260618131250:25` grants `all` — including UPDATE — on `candidacy_votes` to
`service_role`. One stray non-`1.000` row was enough to flip `consensusPercent` back to the weighted
share and zero every other ballot in the displayed consensus.

`20260811100616_equal_vote_weight_constraint.sql` makes the claim true, adding
`check (weight = 1.000)`. The claim should be read as accurate only from that migration onward.

### L28 — the cited document no longer exists; read `docs/FUND-SPEC.md` instead

L28 says _"See docs/FUND-SPEC-AUDIT.md R-C and FUND-13."_ **That file was deleted on 2026-08-11**
(decision D54): it had been superseded as a specification and kept only for an evidence trail that
`docs/FUND-DIVERGENCE.md` already carries with citations, and two documents disagreeing was the
failure this fund documentation set exists to prevent.

Nothing cited by L28 was lost. **FUND-nn numbers carry forward unchanged**, so `FUND-13` is live and
reads the same, now in `docs/FUND-SPEC.md`. The `R-C` label was internal to the deleted audit and has
no successor label; the question it tracked was resolved as decision **D32** in
`docs/FUND-DECISIONS.md` — Aura gates _who may vote_, never how much a vote counts.

The same stale citation appeared in this file's own `20260618131250` entry and was corrected there
directly, that file being editable.

Verified behaviour lives in `supabase/tests/0044_candidacy_votes_rls.test.sql`.

---

## `20260618131250_m7_voting.sql`

### L1-2, L11, L15-16, L38-42, L127 — "Aura-weighted" is no longer how voting works

The file describes the original design: _"M7 voting — Aura-weighted candidacy votes"_ (L1),
_"weight = SERVER-written Aura snapshot (trigger)"_ (L2), the column comment _"Aura snapshot —
SERVER-written (trigger), never client"_ (L11), the RLS rationale at L38-42 (_"the BEFORE-INSERT
trigger overwrites it with the server Aura snapshot… e.g. 0.700… would reject every Aura-holding
voter"_), and L127 (_"trigger snapshots Aura"_).

Superseded on 2026-08-11: the vote is **equal**, weight is a constant `1.000`, and Aura gates
_eligibility to vote_ rather than the weight of a ballot (PRD §4.11; `docs/FUND-SPEC.md` FUND-13).
`20260811091835` changed the trigger; `20260811094524` backfilled existing rows and
reverted the function to `security invoker`, since L50's stated rationale — _"DEFINER — reads
aura_scores cross-RLS"_ — no longer applies to a body that reads nothing.

The **table** comment set at L15-16 was live on staging and production and is corrected in DDL by
`20260811094524` (`comment on` is idempotent). The file comments above cannot be, hence this entry.
There is no `comment on column` for `weight` anywhere, so L11 left no catalog entry to fix — it is
file prose only.

**Signpost for anyone grepping `set_candidacy_vote_weight`:** it has four definitions across the
tree. `20260618131250:51-76` (Aura snapshot, definer) → `20260701155919_m7_voting_weight_trigger_fix_backfill.sql:36-52`
(re-installs the same Aura-snapshot body while fixing where the tamper guard lives) →
`20260811091835:33` (constant `1.000`, still definer) → `20260811094524:47` (constant, **invoker**
— the current one). `20260701155919`'s prose accurately describes its own SQL and so gets no entry
of its own, but it is not the live body and should not be read as one.

Verified behaviour: `supabase/tests/0044_candidacy_votes_rls.test.sql` — the equal-weight invariant,
the `23514` on a service_role UPDATE off `1.000` (`20260811100616` added the CHECK), the trigger
still being bound, and `prosecdef = false`.

---

## `20260617155346_aura_celebration_realtime.sql`

### L7-8 — "idempotent, safe locally + hosted" is false on any project provisioned after ~2026-07

The comment reads _"realtime.messages ships RLS-enabled on Supabase; assert it (idempotent, safe
locally + hosted)"_ over `alter table realtime.messages enable row level security;`. On a current
hosted project that statement does not no-op — it **aborts the whole migration**:

```
ERROR: must be owner of table messages (SQLSTATE 42501)
```

`realtime.messages` is owned by `supabase_realtime_admin`, and `postgres` is not a member of that
role (`pg_has_role('postgres','supabase_realtime_admin','member')` → false). `ALTER TABLE` requires
ownership, and Postgres checks ownership _before_ noticing the change is a no-op — so it fails even
though `relrowsecurity` is already `true`, which is exactly what the statement wanted to assert.

This only bites on a replay from zero. Projects that applied this migration when it was written
carry the result; `supabase db reset --linked` on production hit it on 2026-08-10.

**Workaround, as actually performed on production:** apply the file **minus line 8** — the rest of
it succeeds, because `CREATE POLICY` on `realtime.messages` is permitted for `postgres` (only
`ALTER TABLE` needs ownership) — then record it and continue:

```bash
supabase migration repair --status applied 20260617155346
supabase db push
```

Afterwards confirm the two objects the file exists for: policy `rt_aura_owner_receive` on
`realtime.messages`, and `public.broadcast_aura_celebration(uuid, text, text[])`. RLS on that table
needs no action — the platform ships it enabled, which is the only reason dropping line 8 is safe.

Verified behaviour lives in `supabase/tests/0039_aura_celebration_realtime.test.sql` (the policy and
the emitter), not in the `alter table` this entry supersedes.

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
about who can see the row, not about what the row says. `reasons` was a match-time snapshot
naming the candidate's raw tag keys, and it survived the candidate later hiding those tags;
`20260807201350_purge_stale_momento_proposals.sql` closed that case by deleting the pending
proposals on the flip.

**Superseded (2026-08-12, #273 D).** `20260812145446_momenti_affinity_and_deck.sql` removed the
cause rather than the symptom: `public.get_momenti_deck()` recomputes the affinity terms from
the candidate's CURRENT, visibility-masked tags on every read, so no snapshot exists to go
stale. `momento_reasons()`, the `profiles_purge_momenti` trigger and
`athanor.purge_stale_momento_proposals()` are all dropped, the `reasons` column is blanked and
retired, and hiding a tag now MASKS a pending card instead of deleting it — the trade recorded
in `20260807203343`'s closing note (a hidden candidate being re-proposed with a fresh push) goes
away with it. Asserted in `supabase/tests/0074_purge_stale_momento_proposals.test.sql`, which is
now the inverse of what it used to assert.

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
`s > 300`. The lowest reactor who clears the gate already weighs ≈1.263, so every qualifying ✦
awards **3**. 2 is unreachable — and so is 4: rounding reaches it only from a reactor at ≥1118,
a score the `aura_scores` 0–1000 check constraint (and core's `SCORE_MAX`) makes impossible.
The same wrong base stood in `packages/core/src/score/weights.ts` and PRD §4.9; both were
corrected 2026-08-09. That correction itself overstated the band as **{3, 4}**: PRD §4.9 dropped
the dead 4 arm in the #148 reconciliation (PR #347, 2026-08-13); the tests and this entry were
aligned 2026-08-14 under #55.

And as shipped by THIS migration the award was neither 2 nor 3–4 but **0**. The trigger selected
`v_reactor_score`, gated on it in SQL, and then called `athanor.enqueue_score_award(...)` — which
had no parameter for it. The `pg_net` body carried only `severity`, so `score-engine`'s
`awardCtx` reached `pointsFor` with `reviewerScore` undefined, `?? 0` failed the gate a second
time, and the function returned `{awarded: 0, skipped: true}` with no `aura_events` row. The gate
was written twice and the second copy always lost.

**RESOLVED (issue #27) by `20260809172520_star_reviewer_score_plumbing.sql`**, sequenced before
the hosted deploy so the ledger never has a zero-award era. A 6-arg `enqueue_score_award`
overload carries `p_reviewer_score` into `ctx.reviewerScore`, and the replaced trigger body
sends `coalesce(v_reactor_score, 0)` — the SQL literal `> 300` gate (L49 of this migration, the
rule #10 drift noted below) is GONE with it: core's `pointsFor` with `REACTION_AUTHOR_MIN_SCORE`
is the single authority on the threshold, so a sub-gate ✦ now enqueues and the engine alone
decides it is worth nothing.

Verified behaviour: `packages/core/src/score/award.test.ts` holds the `{3}` band across the
whole qualifying domain (301 … `SCORE_MAX`) plus `pointsFor('post_starred', {})` → `0` (the
safety default, no longer the production path). `supabase/tests/0064_aura_award_triggers.test.sql`
§K — which replaced the tripwire that pinned the defect — asserts the overload exists, the queued
payload carries `ctx.reviewerScore`, the award targets the author, and a scoreless reactor
travels as `0`. `supabase/functions/score-engine/logic.test.ts` pins the engine half: score
500 → 3, domain-max 1000 → 3, ≤ 300 or absent → skipped with no ledger row.

---

## `20260809160525_waitlist_throttle_trigger.sql` — the comment names Vercel; it is Cloudflare now

The prose at L29-30 says «The insert happens inside a Vercel function, so left alone this would
key on that function's egress IP». The mechanism it describes is exactly right and the trigger is
unchanged — but `apps/web` was migrated off Vercel onto Cloudflare Workers on 2026-08-10, so the
insert now happens inside a Worker. Read "Vercel function" as "the serverless function fronting
PostgREST", whichever host that is; the reason the route must forward the visitor's address is
identical either way.

One thing did change in substance, in the route rather than the database. `apps/web/app/api/waitlist/client-ip.ts`
now consults **`cf-connecting-ip` first**, ahead of `x-forwarded-for`. This is a security property,
not a preference: Cloudflare _appends_ the real client to `x-forwarded-for`, so its leftmost entry
is whatever the caller sent. Reading that first would have made the throttle key attacker-chosen
and undone issue #23 entirely. `cf-connecting-ip` is stripped and re-set by the edge and cannot be
forged. The trigger still keys on whatever the route forwards, so nothing here needed a new
migration.

Asserted by: `apps/web/app/api/waitlist/client-ip.test.ts` ("prefers cf-connecting-ip over a forged
x-forwarded-for"), and the first-entry-is-the-client behaviour by
`supabase/tests/0083_waitlist_rate_limit.test.sql`.

---

## `20260811072211_profile_display_name_avatar.sql` — §1 describes a CHECK that no longer exists, and a bound that was never enforced

Two corrections to the prose at L15-24, both closed by
`20260811080937_profile_identity_column_constraints.sql`.

**The constraint named there is gone.** §1 shipped
`check (display_name is null or char_length(btrim(display_name)) between 1 and 60)` as
`profiles_display_name_check`. That constraint was dropped and replaced by
`profiles_display_name_shape`, which adds a bound on the **raw** string and trims the whole
whitespace class rather than spaces alone.

**The stated rationale was only ever half true.** The comment says the cap exists «so a
pathological metadata value cannot push an unbounded string into every feed row». That holds for
the signup trigger, whose input is normalised — but the same migration granted
`update (display_name, avatar_path)` to `authenticated`, and `btrim()` with no second argument
strips **spaces only**. So `repeat(' ', 5000) || 'x'` trimmed to one character, passed, and stored
5001 — precisely the unbounded string the sentence claims to prevent. A name of tabs or newlines
likewise did not trim to empty and stored non-null, rendering as a blank where a name should be.

The avatar half of the same grant had a sharper hole, and §1 does not mention it at all: the
bucket policies bind an object's folder to its uploader, but nothing bound the **column**, and
`avatars_select_member` is members-wide. A member could set
`avatar_path = '<other-uid>/<other-uid>.jpg'` and wear another member's face everywhere a profile
is rendered — no upload, no policy violation, one UPDATE of a column they legitimately own.
`profiles_avatar_path_owned` now requires the first path segment to equal the row's own `id`.

§4 of that migration needs no correction: it claimed the avatars bucket gets the server-side
EXIF/GPS strip, which was false when written — `supabase/functions/media-process` still allowed
four buckets, so every avatar upload answered `bucket not allowed` — and is true now that the
function's allowlist was extended and redeployed.

Asserted by: `supabase/tests/0086_profile_display_name_avatar.test.sql` — the client-write path
for both constraints (impersonation, a space-padded 5001-character name, a whitespace-only name),
and that `handle_new_user` still cannot be made to raise 23514 by any provider value. The
allowlist/trigger agreement is pinned by `supabase/functions/media-process/buckets.test.ts`, which
parses the WHEN clause out of the migrations rather than trusting a comment.

## `20260815093035_declare_winner.sql` — "NULL bounds fail closed, as in cast_vote" was false

The comment above the ballot-window gate claimed a NULL `voting_ends_at` fails closed the way it
does in `cast_vote`. It does not, and the two shapes differ in exactly the way that matters:
`cast_vote`'s NULL lands inside a WHERE clause, where NULL means the row does not qualify and the
surrounding `NOT EXISTS` raises — genuinely fail-closed. `declare_winner`'s gate was an IF:
`if not (now() > voting_ends_at)` evaluates to `not NULL` = NULL, and plpgsql treats a NULL
condition as false — so an edition with an **undeclared** window skipped the gate entirely and
fell through to the quorum and floor checks. Caught the same day by a staging smoke (the refusal
came back `funding floor not met`, two gates deeper than an undeclared-window edition should ever
reach); with quorum and floor met it would have declared a winner on a ballot that never closed.

`20260815094157_declare_winner_window_fail_closed.sql` replaces the body with the NULL arm
explicit: `if voting_ends_at is null or now() <= voting_ends_at then raise`.

Asserted by: `supabase/tests/0103_declare_winner.test.sql` — an undeclared window refuses
`ballot not closed`, and so does a window still open; both before any write.

## `20260618153032_m7_contributions.sql` — anonymous contributions no longer exist

### L8 — "nullable: anonymous contributions allowed"

The column comment described the pre-D24 design. D24 (`docs/FUND-DECISIONS.md`) dropped
anonymous contributions — `create-contribution-session` mints `metadata.profile_id` from the
verified caller on every session — and `20260815120318_fund_contribution_profile_not_null.sql`
(#239) makes the column `NOT NULL` and flips the FK action from `ON DELETE SET NULL` (which
would now raise 23502 mid-delete) to `ON DELETE RESTRICT`.

### L57 — "anon (null profile_id) excluded (MVP)"

The comment inside `recompute_fund_aggregate` implied `contributor_count` could legitimately
describe a smaller population than `raised_cents` sums. With `profile_id` nullable that was a
live defect on the public ticker: an anonymous succeeded row moved the money total but not the
contributor count. The same #239 migration replaces the function verbatim with the corrected
comment — the arithmetic never changed; under `NOT NULL` both aggregates describe the same set
of succeeded rows.

Asserted by: `supabase/tests/0046_fund_contributions_rls.test.sql` — `col_not_null`, a
service_role insert with a null `profile_id` raises 23502, and `raised_cents` /
`contributor_count` derive from the same succeeded rows.

## `20260815193158_fund_closure_rollover.sql` — the released amount is ledger-read since #247

### L37-39 / L230-232 — "there is no tranche ledger yet — #228/#229 own realization plans, and tightening this parameter to a ledger read is theirs"

The header (and the matching in-body comment ahead of the `p_released_cents` range check)
deferred the ledger read to #228/#229. The lane ruling on #247 assigned it there instead:
`20260815215924_fund_payout_ledger.sql` creates `fund_payout_ledger` (a cache of Stripe
`transfer.created`/`transfer.reversed` webhooks) and replaces `close_cycle` WITHOUT the
`p_released_cents` parameter — on `realization_failed`, `disbursed` is now
`sum(amount_cents − reversed_cents)` over the cycle's ledger rows, never an operator-typed
figure. #228/#229 still own tranche _scheduling_ (when and how much releases); what WAS
released is the ledger's alone. The three released-shape refusals (`released not applicable`
/ `released required` / `released out of range`) no longer exist.

Asserted by: `supabase/tests/0112_fund_payout_ledger.test.sql` (ledger cap + close_cycle
reading it) and the updated `supabase/tests/0110_fund_closure_rollover.test.sql`.

## `20260816164834_hosted_grant_sweep.sql` — the derivation counted RESTRICTIVE policies

Corrected in place by `20260816171549_hosted_grant_sweep_permissive_only.sql`, in the same PR.

### L36-37 — "a role gets exactly the verbs its RLS policies mediate"

The method is right; the execution read `pg_policies` without filtering on `permissive`. A
RESTRICTIVE policy grants nothing — it can only subtract from what a PERMISSIVE policy already
allows, so a verb whose only policy is restrictive is a verb the table never permitted.

#106's moderation net (`active_write_insert` / `active_write_update` / `active_write_delete`) is
RESTRICTIVE and sits on most user-content tables. Every table carrying it therefore _looked_ like
it had INSERT/UPDATE/DELETE policies. The migration restated grants accordingly and wrote them
into `0121`'s expected list, so the tripwire built to catch over-permissioning would instead have
certified it.

Seventeen (object, verb) pairs were affected, across sixteen `revoke` statements —
`athanor_days_interest` is the only table that loses both verbs:

- **UPDATE** — `candidacy_votes`, `post_reactions`, `story_reactions`, `athanor_days_interest`.
- **DELETE** — `athanor_days_interest`, `posts`, `post_comments`, `story_segments`, `moments`,
  `dreams`, `dream_milestones`, `dream_candidacies`, `milestone_helps`, `favor_offers`,
  `projects`, `events`, `rsvps`.

`post_reactions` and `story_reactions` keep DELETE: a reaction is toggled off by deleting it, and
both have a permissive delete policy. None of the seventeen was reachable — with no permissive
policy, RLS denies the statement whatever the grant says — which is why the staging smoke passed
both before and after.

### L49 — "Interest in an Athanor day — the owner's own row, full CRUD (5 policies)"

Not full CRUD. `20260615100305_athanor_days_interest.sql` creates `_select_own` and `_insert_own`
only; the other three of the five are #106's restrictive write net. The client registers interest
with an upsert whose `ignoreDuplicates` maps to `on conflict do nothing`, so INSERT alone serves
it.

### L53 — "Ballot votes — cast, change, withdraw your own (6 policies)"

There is no _change_. `20260618131250_m7_voting.sql:29-46` creates `_select_own`, `_insert_own`
and `_delete_own`, and says so in terms: «no UPDATE policy/grant: a vote is immutable; changing
it = delete + insert». The `20260811091835_equal_vote_weight.sql` entry above spells out why that
matters: an unguarded UPDATE path on `candidacy_votes` is what let a single non-`1.000` weight
flip `consensusPercent` to the weighted share and zero every other ballot in the displayed
consensus. That hazard is now bounded by `check (weight = 1.000)`
(`20260811100616_equal_vote_weight_constraint.sql`), and it concerned `service_role`'s grant
rather than a client's — but the sweep handed the same verb to `authenticated`, on a table whose
creating migration declares it immutable. The follow-up revokes it.

### L57-58 — `circle_memberships`: the named revoke was a different migration

The comment credits `20260618204459_m8_circle_memberships.sql` with "its own revoke named `insert,
update, delete`". That migration does no such thing: `:27-28` is `revoke all … from anon` plus
`grant select … to authenticated`, and it never names the three verbs. The named revoke is
`20260618205358_m8_circle_memberships_revoke_authenticated_writes.sql:6`, a separate migration
written for precisely the reason the sweep describes.

Nothing enforced changes — `circle_memberships` is SELECT-only for clients either way, and the
sweep restates that correctly. Only the attribution is wrong.

### L181-183 — "Recreated by three separate migrations, each of which restated `revoke all … from anon` / `grant select … to authenticated`"

Only the first did. `20260618131250_m7_voting.sql:158-159` runs the revoke/grant pair — and note
it revokes from `anon` only, never from `authenticated`.
`20260812120121_candidacy_thumb_path.sql:18-22` and
`20260816151600_fund_candidate_cards_ballot_fields.sql:82-84` contain no grant or revoke at all:
both use `create or replace view` _specifically because_ it preserves the existing ACL, and each
says so. So the residue has a simpler cause than the comment gives it — `authenticated` was never
revoked in the first place and kept the hosted default set continuously; the two later
recreations left it untouched rather than restoring it.

Asserted by: `supabase/tests/0121_grant_catalog_sweep.test.sql` — the declared surface, plus
«every client grant on a table has a PERMISSIVE policy behind it», which is the assertion that
would have caught all of the above.

## `20260816071602_fund_settle_sweep.sql` — the sweep is live since #231

### L7-10 — "Today that answer is zero due tranches BY CONSTRUCTION — the enumeration source is #228/#229's realization-plan schema, which does not exist yet… a deliberately inert skeleton"

True when written, false from `20260816110227_fund_tranche_gate.sql` onward. The
enumeration source shipped hours later (`20260816073905` gave the phases,
`20260816082552` the authoring and publication path), and #231 supplied the missing half
the same header names: the verification slot in `release-fund-payout`'s refusal ladder.
The sweep now enumerates a published plan's verified, not-yet-fully-released phases and
can move money; "inert by construction" describes only the window between
`20260816071602` and `20260816110227`.

What did NOT change is the division of labour that paragraph states, which remains exact:
the wrapper still carries no eligibility logic, still posts `{"mode":"sweep"}`, and the
executor still decides whether anything moves. The cadence rationale (daily, 04:41 UTC)
and the whole key-handling paragraph stand unamended.

The `invoke_fund_settle_sweep()` function comment said the same thing and WAS replaceable,
so `20260816110227` replaces it in place rather than leaving two sources of the claim.

Asserted by: `supabase/tests/0117_fund_tranche_gate.test.sql` (verification refusals, the
release gate, per-phase attribution) and
`supabase/functions/release-fund-payout/logic.test.ts` (sweep-mode enumeration).
