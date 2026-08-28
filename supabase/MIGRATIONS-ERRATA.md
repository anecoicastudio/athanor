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

## `20260828083140_publish_post_atomic.sql` — "The BYTES are not swept" is now superseded

The header's `:159` and the comment above the sweep both read «The BYTES are not swept. Objects
the previous set uploaded and this one does not reference stay in the `post-media` bucket, the
same trade the composer already makes for an abandoned draft.» That was true when it was written
and is no longer: `20260828103400_post_media_bytes_reaper.sql` (#589) adds
`post_media_reap_candidates` and the nightly `reap-post-media-bytes` job, which frees exactly
those objects — plus the posters that go with them, reached through `thumb_path`.

Nothing about `publish_post` changed, which is why the correction lives here rather than in a new
version of the function. The sentence is still right about this migration: the sweep it performs
is a row sweep, in the caller's transaction, and it deliberately costs no round trip for a
pre-read of the old paths. What is no longer right is the implication that the bytes stay
forever. Read it as «the bytes are not swept **here**; the reaper frees them nightly».

The clause about erasure is unaffected and still true — `gdpr_storage_footprint` sweeps the
bucket by `{uid}/` prefix either way, which is why #589 is a storage-cost fix and not a
compliance one.

Asserted by: `supabase/tests/0139_post_media_bytes_reaper.test.sql` §5, which drives two real
`publish_post` calls — a two-item set then a one-item set — and asserts that the objects the row
sweep orphaned become reap candidates. If `publish_post` ever stops sweeping, or sweeps
differently, that is where it surfaces.

## `20260828083140_publish_post_atomic.sql` — the header's "changes no grant" is narrower than the file

The header's `:23` reads «It is also why this migration changes no grant.» The file ends with two
grant statements at `:184-187`:

```sql
revoke execute on function public.publish_post(…) from public, anon;
grant  execute on function public.publish_post(…) to authenticated;
```

The paragraph's own next clause scopes the claim correctly — it is `0121_grant_catalog_sweep`'s
declared **table** surface that is untouched, and it goes on to name the `revoke` as something
0121 requires — but the flat sentence read alone says something the file contradicts, and it
never mentions the `grant execute` at all. Read it as «changes no **table** grant».

The substantive half is true and asserted: `authenticated` keeps exactly the privileges it
already held on `posts` and `post_media`, because the RPC is SECURITY INVOKER and needs no more.
`supabase/tests/0138_publish_post.test.sql` holds the verified EXECUTE surface — `authenticated`
may execute it, `anon` may not, and PUBLIC holds nothing — and 0121 pins the two allow-lists that
make the revoke necessary. Nothing is enforced less than the comment claims; the comment simply
does not describe the two lines that make its own claim about 0121 come out right.

---

## `20260825074614_gdpr_revoke_sessions.sql` — one comment narrower than its statement, one header wider than the evidence

Neither changes what the SQL does. Both were caught in review after the migration had reached
staging, and rule #7 does not let a comment be edited in place. The verified behaviour lives in
`supabase/tests/0134_gdpr_revoke_sessions.test.sql`.

### The refresh-token sweep's `:50-52`

The comment reads "Orphans only (session_id is NULL); the cascade above has already taken the
rest". The statement below it carries no such predicate:

```sql
delete from auth.refresh_tokens where user_id = p_user_id::text;
```

It deletes **every** refresh token of the subject. Orphans are only what is _left_ for it by the
time it runs, and that is a fact about the preceding cascade
(`refresh_tokens_session_id_fkey`), not about this statement's reach. The distinction matters to
anyone reading the function during an incident, and more to anyone who concludes a
`session_id is null` predicate was dropped by accident and "restores" it — that would narrow the
sweep to less than the erasure needs.

Nothing is enforced less than the comment claims: it errs wide, and deleting a subject's refresh
tokens is exactly what erasure step (1) is for. 0134 asserts both halves — the orphan goes
(`pgtap0134-orphan`) and another member's token does not (`pgtap0134-o1`).

### The header's account of #542, `:5-9`

The header says «every call 401'd» and «every live erasure landed `failed` with the member's
sessions still open». The _mechanism_ is deterministic and verified: a UUID in the `Authorization`
bearer is a 401, every time, and #542's staged proof recorded a request landing `failed` for
exactly that reason.

What is not verified is the scale. `erasure-job` is deployed but **unscheduled** and behind the
legal gate, staging's `gdpr_erasure_requests` is empty, and production was not queried — so how
many live erasures actually ran, if any, is unknown. Read «every live erasure» as the
counterfactual it is: every erasure that ran, or would have run, took this path. The header
should not be read as a record of an observed production incident.

---

## `20260822103819_paid_event_insert_gate.sql` — two comments, both about how the file points at other things

Neither changes what the SQL does. Both are recorded rather than fixed because the migration had
already reached staging when they were caught, and rule #7 does not let a comment be edited in
place.

### The WHEN-clause note's `20260812225214:186-190`

The `create trigger rsvps_enforce_capacity` statement it cites as the precedent spans **185-189**;
`:186` lands one line inside it and `:190` is past its semicolon. The claim is right and the
coordinate is one off in both directions. Every other reference in that file — `20260818190348:70-80`
and `:72,78`, `20260617225450:27-39`, `20260815164809:228`, `20260615094844:31` — was checked
against the tree in the same pass and holds.

### "SECURITY INVOKER (the default, stated by omission as elsewhere in this schema)"

`enforce_paid_event_gate()` **is** invoker, and invoker **is** PostgreSQL's default, so the function
is what the sentence says it is — `pg_proc.prosecdef` is false and `0121` reads that axis, not the
prose. What is wrong is "as elsewhere in this schema": omission is the minority here.
`touch_updated_at`, `favor_offers_guard`, `fund_editions_ballot_open_check`,
`guard_momento_status_change` and `milestone_helps_guard` all write `security invoker` out;
`realization_updates_binds_winner` is the only prior function that leaves it implicit. **The
convention is to state it.** Do not read that sentence as licence to omit the clause in the next
trigger function — a security-relevant declaration an auditor has to infer from a default is worth
one keyword.

## `20260821075230_story_segment_bytes_reaper.sql` — the definer rationale and the two-arm policy claim

Both corrected by `20260821082216_story_segment_reaper_review_fixes.sql` in the same PR (#31);
the behaviour is held by `supabase/tests/0126_story_segment_bytes_reaper.test.sql`. Recorded here
because the file had reached staging before review caught them.

### `story_segment_reap_candidates` — "SECURITY DEFINER because it reads storage.objects across every owner folder and joins a table whose own policy would otherwise hide the expired rows"

Wrong for its only grantee. `service_role` carries BYPASSRLS and SELECT on both
`storage.objects` and `public.story_segments`, so an INVOKER function returns identical rows —
the `gdpr_erase_fund_footprint` precedent (`20260815131925`, "definer rights would add nothing").
The follow-up migration replaces it as `security invoker`; 0126 asserts `isnt_definer`. The
sentence generalising the pg_net-caller convention ("definer + locked search_path + revoked
client EXECUTE is the audited shape of every cron/pg_net helper here") to a data-reading RPC is
the part not to copy: it applies to functions that only POST, not to functions that read.

### Header, "The owner-folder regex and `athanor.not_blocked` from the SELECT policy are NOT mirrored"

Incomplete. The policy the predicate inverts is the one `20260818114947_banned_read_side_hiding.sql`
recreated, and it has a **third** viewer-side arm, `athanor.not_banned(...)`. It is omitted for the
same reason as the other two (it is about who may read, not whether the segment is alive — a
banned author's live or pinned segment keeps its bytes), but the header lists only two and cites
`20260809151111` as the policy's text. 0126 no longer compares the RPC against a hand-typed copy
of the predicate; it reads `storage.objects` as a member under the real policy and asserts that
no candidate is readable and that the readable set is the bucket minus the candidates.

---

## `20260818190348_organiser_settlement_ack.sql` — «Never client-supplied» is the RPC's guarantee, not the column's

### The `comment on column public.events.settlement_ack_at` — "Never client-supplied."

True of `create_event`, which takes a boolean and stamps the timestamp from `now()`, and false as a
statement about the column. **Half of that is now closed** — see the update below — but the sentence
in the migration is still not true as written.

As applied, `authenticated` held **table-level** `insert, update` on `public.events`
(`20260615094844_events.sql:67`), and both `events_insert_own` and `events_update_own`
(`20260615094844_events.sql:82-91`) predicated on ownership alone — neither restricted which columns
a row may carry. So an organiser holding a session could bypass the RPC entirely and write
`settlement_ack_at` to any value on a row they own, along with a `price_cents` the RPC would have
refused.

What that does and does not cost:

- **No money moves.** `create-ticket-checkout` re-derives `is_identity_verified(event.organizer_id)`
  itself and fails closed, so a forged row still sells no tickets.
- **It does weaken the record.** The addendum on #437 persisted the acknowledgement precisely because
  an unrecorded tick has the evidentiary value of a notice; a forgeable one is not much better.

**Amended by #446** (`20260819041755_events_column_scoped_client_grants.sql`), which closes the
UPDATE half. The grants are now column-scoped, the `profiles` pattern that keeps `founding_member`
and `identity_verified` unwritable by their owner:

- **UPDATE is gone.** `revoke update … from authenticated`, and `events_update_own` is dropped with
  it (a PERMISSIVE policy with no grant behind it is a vestige `0121` fails on). Nothing in
  `apps/native`, `apps/web`, `packages/api` or `supabase/functions` updates an event; the live
  window is swept by `live_window_sweep()` under `pg_cron`, and erasure is the service-role GDPR
  job. **A stamped `settlement_ack_at` can no longer be rewritten.**
- **INSERT is scoped to the fourteen columns `create_event` writes.** `fee_pct`, `is_kairos_day`,
  `is_athanor_day`, `cover_url`, `live_started_at`, `live_ended_at`, `id` and the timestamps are
  no longer client-writable at all.

**The INSERT half survived #446 by construction, and #448 closed it.** `create_event` is
`SECURITY INVOKER` (`20260818190348_organiser_settlement_ack.sql:58`), so its INSERT runs with the
caller's privileges and `price_cents` and `settlement_ack_at` _have_ to stay in the caller's grant.
Grants cannot express "`price_cents > 0` requires X" — that is a predicate over values, and the
privilege system has no way to state one. So until 2026-08-22 a direct INSERT still created a paid
event carrying a self-supplied `settlement_ack_at` and no verified identity, skipping both of
`create_event`'s refusals.

**Amended again by #448** (`20260822103819_paid_event_insert_gate.sql`): a `before insert on
public.events` trigger, `events_enforce_paid_gate`, raising `create_event`'s own `22023` when a row
with `price_cents > 0` carries no `settlement_ack_at` and its own `42501` when the organiser is not
`identity_verified` — same codes, same messages, same order, so a refusal is indistinguishable by
path. The price test is the trigger's `when` clause, so a free event never fires it, and the gate
reaches every writer including `service_role`, which is more than a policy could have done.

INSERT only, deliberately: `authenticated` has held no UPDATE since #446, so there is no client
UPDATE path for an `or update` arm to gate, and such an arm would instead fire against the
service-role and `pg_cron` writers that legitimately update unrelated columns on rows predating the
trigger — `staging-seed/refresh-staging.sql` re-stamps two paid events hourly that way. The
migration states that choice in full; `0125` pins it as `tgtype = 7`.

The fixture churn a trigger was always going to cost was paid in the same change. The three paid
events in `supabase/staging-seed/seed-staging.sql` now carry `settlement_ack_at`, and their
organisers (`tino_chef`, `gio_musica`, `dario_legno`) are `identity_verified` — +150 more disclosed
seed Aura, recorded in that file's own header. The four pgTAP fixtures that insert a paid event
(`0025`, `0026`, `0079`, `0090`) do the same; the four that only `select` `price_cents` or insert
free events are untouched. `pnpm staging:refresh` only UPDATEs, so it never fires the trigger.

**What is still not true as written**, and why this entry is amended rather than deleted: the column
comment's «Never client-supplied». The trigger enforces that an acknowledgement was _made_ — the
thing no privilege could express — but on a direct INSERT the _timestamp itself_ is still the
caller's, because only `create_event` stamps it from `now()`. The sentence remains the RPC's
guarantee, narrowed from "presence and value are both forgeable" to "the value is".

Read the migration's own grants note (`:33-38`, "Grants are deliberately untouched. `authenticated`
holds table-level select/insert/update on public.events") as a statement about the day it was
applied. Its warning still stands and is the reason #446 used named-verb revokes: `revoke all on
table public.events` would drop the anon column ACLs.

### The header's `create-ticket-checkout/logic.ts:118`

The refusal is at `:125`. The line has moved twice already — #437's own ruling cited `:121` — which is
why the claim, not the coordinate, is what the test holds.

Asserted by: `supabase/tests/0125_event_settlement_ack.test.sql` — the RPC's refusals and its
server-side stamp; the privileges that bound how far those refusals reach (no client UPDATE, no
table-level INSERT, `settlement_ack_at` still insertable by column, `fee_pct` refused at the
privilege layer); and, since #448, the trigger's shape plus both of its refusals on the direct path,
as `authenticated` and as `service_role`, with a free event shown still going through.
`0121_grant_catalog_sweep` holds the catalog-wide statement, including the `revoke execute` a
trigger function owes it.

## `20260818095917_reserved_handles.sql:14-18` — the grant IS in the migrations, and is named there

The header says `profiles.handle`'s INSERT and UPDATE grants to `authenticated` were "verified
against this project's `information_schema.column_privileges`, not inferred from the migrations,
which never mention the grant". The first half is true; the second half is false and checkable.

`20260617225450_m7_candidacy.sql:16-18, 21-23` grants them by name and comments the column set:

```sql
revoke update on table public.profiles from authenticated;
grant update (handle, bio, locale, visibility, identity_tags, seeking, updated_at)
  on table public.profiles to authenticated;
revoke insert on table public.profiles from authenticated;
grant insert (id, handle, bio, locale, visibility, identity_tags, seeking)
  on table public.profiles to authenticated;
```

The two later migrations that touch these column ACLs (`20260811072211_profile_display_name_avatar.sql`,
`20260814104755_profiles_mission_skills_city.sql`) are additive and say so, and nothing revokes
them afterwards, so that grant is still the live one. A grep for it does not come back empty.

**The reasoning the header exists to carry is unaffected**, which is why the SQL needed no change:
the client genuinely holds the grant, so a client-side reserved-handle check is bypassable and the
guard has to be a CHECK. Only the provenance sentence is wrong — read it as "the hosted catalog
confirms the grant `20260617225450` declares", not as a case of hosted drift. The rule it cites
(`rules/supabase-db.md`: hosted projects drift wider than their migrations) is real and remains
the reason to query the catalog rather than trust a grep; it is simply not what happened here.

Asserted by: `supabase/tests/0123_reserved_handles.test.sql`, which now pins the privilege itself
with `has_column_privilege` instead of leaving it as prose — the claim the whole guard rests on
should fail a test when it stops being true, not merely mislead a reader.

## `20260817180039_verify_phase_evidence_blank_trim.sql` — two refs into the edge function point at the wrong lines

### L10-12 — "the sole caller (verify-plan-phase/logic.ts:61) validates with Zod's .trim().min(1)"

The caller — the `db.rpc('verify_plan_phase', …)` call — is around `:61`. The Zod validation the
sentence is actually about is `supabase/functions/verify-plan-phase/logic.ts:24`
(`evidence: z.string().trim().min(1).max(1000)`). The claim itself holds: JS `String.trim()`
strips `U+00A0` and `U+2028`, so the caller does refuse these strings before the database sees
them, and the SQL-side trim remains defense in depth.

### L43-44 — "verify-plan-phase/logic.ts:37-61 maps them to client codes"

That range covers a docblock and unrelated body-parsing code. The `REFUSALS` table is
`logic.ts:40-49` and it is applied at `logic.ts:65-68` — `dbErr.code === 'P0001'` is looked up by
**message text**, and anything absent from the table becomes a 502. The invariant the sentence
exists to state is unchanged and is the reason the strings must never be reworded: `'evidence
required'` and `'evidence too long'` are keys, not prose.

Asserted by: `supabase/tests/0117_fund_tranche_gate.test.sql` (the refusals, pinned by message
text) and `supabase/functions/verify-plan-phase/logic.test.ts` (the status mapping).

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

## `20260823103624_event_reminder_sweep.sql` — the first floor was one tick wide, and retention was gated

Recorded here because the file had reached staging before review caught both; the SQL is
replaced by `20260823110358_event_reminder_sweep_guard_band.sql` and the header below is what
stayed wrong.

### L31-38 — "The slots are made NON-OVERLAPPING rather than independent… Without that floor, someone who RSVPs 30 minutes before an online event satisfies both slots on the same tick and receives two identical notifications one second apart"

Overstated. The floor it describes — t24 for an online event applies only when the event is
more than 1h out — made the slots disjoint **per tick** and no more. An online event 1h+30s
out claimed t24 on one tick and t1 on the very next minute, so the attendee received the two
identical reminders the paragraph says the floor prevents, sixty seconds apart instead of one.
`20260823110358` raises the online floor to 3h (the t1 lead plus a 2h guard band), so an online
RSVP between 1h and 3h out gets no t24 and waits for its t1, and anyone further out gets both
at least 2h apart. The rest of the paragraph — why a late RSVP to a physical event still gets
t24, and why the copy stays true at any distance inside the window — stands.

### L157-160 — "Retention… Pruned here rather than by a second cron, so this table cannot inherit the 'function exists, schedule does not' gap"

The reaper was placed below the "fan-out unconfigured → return" guard, so on a project
without the Vault pair (or during a rotation window) it never ran — the table stopped being
claimed _and_ stopped being pruned, which is a different gap from the one the comment guards
against but the same outcome. `20260823110358` runs the delete first and unconditionally.

Asserted by: `supabase/tests/0130_event_reminder_sweep.test.sql` — «an online event inside
the 3h guard band claims neither slot» and «an unconfigured sweep still prunes 30-day-old
markers (retention runs before the guard)».

## `20260823121933_fund_broadcast_notifications.sql` — the dedupe index is not partial any more

Recorded here because the file reached staging before a live broadcast proved the index
unusable as a conflict target; the index is replaced by
`20260823124203_fund_broadcast_dedupe_index_inferrable.sql` and the header below is what stayed
wrong.

### L36-38 — "The index is PARTIAL (`where dedupe_key is not null`) because every existing producer writes no dedupe key and must keep being able to write two identical rows"

The reason is right and the mechanism named for it is wrong. A partial unique index cannot be
inferred by `ON CONFLICT` unless the statement repeats the index predicate, and PostgREST's
`on_conflict=` parameter carries column names only — there is nowhere to put a `WHERE`. So the
bulk insert the same migration was written to enable failed outright with `42P10: there is no
unique or exclusion constraint matching the ON CONFLICT specification`, and the broadcast wrote
zero rows. `20260823124203` drops the predicate.

Nothing about the stated intent changes: two unkeyed rows still both insert, because NULLs are
DISTINCT in a btree unique index. That was always what protected «Hai un Momento» twice being
two Momenti — the predicate only kept the index off the unkeyed majority of the table, which is
a size decision, not a correctness one. The cost of losing it is that the index now covers every
row; the replacement migration's header explains why that trade was taken and what to do instead
if the table ever grows enough for it to matter.

The line in the same header that says a keyed row is "Unique per recipient while not null"
stands — that is still exactly the behaviour.

Asserted by: `supabase/tests/0131_fund_broadcast_notifications.test.sql` — «the dedupe index is
NOT partial, so ON CONFLICT can infer it through PostgREST» and «the dedupe index treats NULLs
as DISTINCT (unkeyed rows are never deduped)».

## `20260824070529_notification_dispatch_outbox.sql` — only a 400 is deterministic, and the retention delete does not filter `created_at`

Recorded here because the file reached staging before review caught the abandon predicate; the
reconciler is replaced by `20260824071839_notification_dispatch_retry_platform_4xx.sql` and the
header and comments below are what stayed wrong.

### L263-267 — "A 4xx is deterministic: the same body will be rejected the same way every time … so it is abandoned on sight", over `if v_d.status_code between 400 and 499`

True of the only 4xx `notification-fan-out` itself emits — `400 {"error":"missing fields"}` and
`400 {"error":"unknown audience: …"}` — and false of everything the PLATFORM answers in front of
it. A `401` while the fan-out key is mid-rotation, a `404` before the function is deployed or on
a cold-start miss, a `403`, a `429` under a burst: all recoverable, and all the exact class the
outbox was written to survive. As written the sweep abandoned every pending dispatch on the
first tick of that outage — a worse failure than the one #521 reported, which lost one
notification per transient 5xx rather than all of them at once. `20260824071839` narrows the
predicate to `v_d.status_code = 400`.

### L297 — the function comment's "marks abandoned_at after 3 attempts, or on sight for a deterministic 4xx"

Same correction: on sight for a **400**. `20260824071839` replaces the comment along with the
body.

### L104 — "Abandoned rows are reached by the retention delete on created_at"

Wrong column, and the index it justifies is the right one anyway. The retention delete (L227)
filters `abandoned_at < now() - interval '30 days'`, not `created_at`, and
`notification_dispatches_open` is partial on `abandoned_at is null` so it excludes abandoned rows
by construction. The sentence's point — that the partial index does not have to cover abandoned
rows because something else reaches them — holds; the column named is not the one that does it.

Asserted by: `supabase/tests/0133_notification_dispatch_outbox.test.sql` — «a 401 IS retried —
the platform rejected the key, not the body», «a 400 is abandoned on the first attempt — the same
body would be rejected identically» and «an abandoned dispatch is reaped after 30 days».

## `20260615094844_events.sql`, `20260812054134_restrict_anon_event_columns.sql`, `20260819041755_events_column_scoped_client_grants.sql` — `is_kairos_day` no longer exists

All three predate `20260826080246_retire_is_kairos_day.sql`, which folded the legacy premium flag
into `is_athanor_day` (`set is_athanor_day = true where is_kairos_day`) and dropped the column.
«Kairos» is a pre-Athanor name and was retired from the whole tree on 2026-08-26; these appearances
survive only because applied migrations are append-only. Read every `is_kairos_day` reference in
them — the column definition, the anon column-scoped grant list, and the two comment mentions in
`20260819041755` — as describing `is_athanor_day` alone today. The premium chip logic
(`event-row.ts` and the public event page) now keys on the single remaining flag.

Asserted by: `supabase/tests/0020_events_rls.test.sql` — the anon column-read assertion no longer
selects the dropped column, and the from-zero CI replay applies the fold before anything reads it.

## `20260827054252_chat_media_images.sql`

Two corrections, newest first.

### §1 and header item 3 document a key layout the SQL did not enforce (#575)

§1 states the path convention as `{sender_uid}/{conversation_id}/{media_id}.jpg` (lines 24-26),
and header item 3 (lines 10-11) says `messages_insert_own_user` "pins the media key to the
sender's own folder for that conversation" — §4 (lines 133-139) puts it as "a non-null media_url
must sit in the sender's own chat-media folder FOR THIS conversation." Every one of those
sentences is true as far as it goes, and a reader reasonably concludes the whole layout is what
the database holds. It was not, on any gate:

- `messages_insert_own_user` (line 153) pinned `media_url like '{sender}/{conversation}/%'`.
  LIKE's `%` matches zero characters and any depth, so the bare prefix `{sender}/{conversation}/`,
  a nested folder, and any extension all satisfied it.
- The three `chat-media_*` storage policies (lines 38-98) constrained
  `(storage.foldername(name))[1]` and `[2]` only. `storage.foldername` drops the LAST segment, so
  the filename was never looked at, and the array was never length-bounded —
  `{uid}/{conv}/sub/dir/anything` passed every one of them.
- Those segment guards were `~*`, i.e. case-INsensitive, while `chatMediaKey` in
  `packages/schemas` spells `[0-9a-f]` with no `i` flag. An uppercase-hex key passed SQL and
  failed Zod.

No authorization was ever affected: the sender-folder equality and the conversation-membership
EXISTS carry that, and `20260827092629_chat_media_key_shape_pin.sql` did not touch them. What was
affected is the agreement between the two mirrors — the client refused keys the database would
have taken, and nothing tested the difference.

Read the convention as a description of what the client produces, and `20260827092629` as the
migration that made it a rule, on the three WRITE gates. `chat-media_select_participant`
deliberately still pins path segments only: tightening a read predicate retroactively hides bytes
already stored, and a filename tells a reader nothing that membership and
`not_blocked`/`not_banned` do not already decide.

Asserted by: `supabase/tests/0136_chat_media.test.sql` — the whole-key pin on both owner-write
policies (both halves of the UPDATE separately), the case-sensitive operator, the deliberate
read-side asymmetry, the five keys the prefix pin used to accept, and the bucket's own write gate
exercised under a JWT — and `packages/schemas/src/chat-media-key.mirror.test.ts`, which compares
the SQL literal against `chatMediaKey` as strings across every `create policy` and `alter policy`
that names them.

### "Erasure/moderation delete via service role" describes a capability, not existing code

The §2 comment explaining the missing delete policy ends "Erasure/moderation delete via service
role, which needs no policy." The mechanism claim is true — the service role bypasses storage RLS,
so no policy is needed for a privileged delete — but at the time the migration was applied **no
erasure code touched `chat-media`**: `erasure-job` swept only the candidacy-videos manifest, and no
reaper covers this bucket. The same gap held for `post-media`, `moments`, `story-segments` (whose
nightly reaper frees only ORPHANED objects, so a live segment's bytes survived too) and `avatars`,
and for the member's own `exports` archives, which no code path had ever deleted from. An erased
member's chat-image bytes therefore persisted, unreadable by any client policy but never deleted.
Read the sentence as it was written: the privileged delete needs no policy — not that erasure
performed one.

**The erasure half is closed by #573** (`20260827110034_gdpr_storage_footprint_sweep.sql`).
`gdpr_storage_footprint` lists every object under the member's `{uid}/` prefix across all seven
declared buckets, and `erasure-job` removes it in re-listing rounds. The **moderation** half of
that same sentence still describes a capability rather than existing code: `moderation-enforce`
names no bucket and calls no `remove()`, so a suspension or ban hides a chat image behind the
policies and leaves its bytes in place. Read the sentence as closed for erasure only.

Two things this entry is often misread as also claiming, and does not: the **export** side was
never narrow — `gdpr-export-job` selects `messages.*`, so `media_url` (the chat-media key) has
always been in the archive, as have the key columns of every other bucket. And the export carries
**keys, not bytes**, for every bucket including candidacy-videos; whether Art. 20 wants the bytes
themselves is an open product decision, not a defect of this migration.

Asserted by: `supabase/tests/0137_gdpr_storage_footprint.test.sql` (the manifest is exactly one
object per declared bucket, the prefix is anchored, a bucket outside the list is not swept),
`supabase/functions/erasure-job/sweep.test.ts` (the removal rounds, and every way the sweep can
quietly do nothing) and `supabase/functions/erasure-job/sweep-buckets.test.ts`, which mirrors the
bucket list against every `insert into storage.buckets` in the migrations and against
`packages/api`'s `MediaBucketName` — so the next bucket cannot repeat this.

## `20260827110034_gdpr_storage_footprint_sweep.sql`

### "the owner-write storage policies enforce exactly that shape" is true of six buckets, not seven

The comment above the prefix predicate explains why one `{uid}/` filter covers every bucket, and
attributes the guarantee to the buckets' own write policies. That holds for the six user-upload
buckets. It does **not** hold for `exports`: `20260620140149_m9_gdpr_export_erasure.sql` creates
that bucket with **no `create policy` at all** — nothing writes to it but the service role, and
nothing reads from it but a signed URL — so no policy constrains its keys.

The shape is real all the same; its source is code, not SQL. `gdpr-export-job` writes each archive
at `${job.profile_id}/${job.id}.json` (`supabase/functions/gdpr-export-job/logic.ts`), which the
same migration comment notes a dozen lines earlier when it explains why `exports` is in scope.
Read the parenthetical as covering the six, with `exports` held to the shape by its only writer.

The consequence to watch: a future writer to `exports` that chose a different key layout would
silently fall out of the sweep, and no policy would stop it. There is only one writer today.

Asserted by: `supabase/tests/0137_gdpr_storage_footprint.test.sql` seeds an `exports` object at
the `{uid}/` shape and asserts the manifest lists it, so the sweep's coverage of that bucket is
pinned regardless of where the shape comes from.

### "the drift that let chat-media reach main unswept" — chat-media never reached main

The comment above the bucket `in (…)` list explains why the list is explicit and mirror-tested, and
attributes the need to `chat-media` having shipped unswept. The mechanism is right and the example
is wrong. `chat-media` was created by `20260827054252`, which is on `dev` only; `origin/main` is
`b203c48` (2026-08-12) and has never carried that migration. `chat-media` is the bucket whose
arrival made the gap visible enough to file, not the one that shipped it.

The claim the sentence was reaching for is worse than the one it made, and worse than the first
draft of this paragraph said. At `b203c48`, `erasure-job` has **no storage port at all**: its
`ErasureCtx` is `{ db, auth }`, `ErasureAuth` exposes only `signOut`, and no file under
`supabase/functions/erasure-job/` contains a `remove(` call or the word `storage`. The
candidacy-videos manifest is not a narrower reach there — it does not exist, because
`20260815131925_gdpr_fund_erasure_tombstone.sql`, which creates `gdpr_erase_fund_footprint`,
postdates that sha and is on `dev` only.

So a GDPR erasure at `b203c48` deletes **no bytes from any bucket**, and that sha declares six:
`post-media`, `moments`, `story-segments`, `candidacy-videos`, `avatars`, `exports`. The drift did
not need a seventh bucket to happen — it had already happened six times. On `dev` the count then
moved twice: `20260815131925` narrowed it to five on 2026-08-15, `20260827054252` widened it back
to six on 2026-08-27 by adding `chat-media`, and this migration closes all of them.

Asserted by: nothing, and nothing should — which commits a remote branch contains is a fact about a
branch at a point in time, not a property of the schema, and a test pinning it would go red at the
next release for the right reason and then be deleted. Every count above is anchored to the sha or
date beside it — six at `b203c48`, five on `dev` from 2026-08-15, six again from 2026-08-27 — and
none of them survives this branch reaching `main`, which is the point. Do not carry a number here
forward without its anchor. `supabase/functions/erasure-job/sweep-buckets.test.ts` holds the half
that IS a property — that the sweep's list covers every declared bucket — and that is what stops
an eighth.
