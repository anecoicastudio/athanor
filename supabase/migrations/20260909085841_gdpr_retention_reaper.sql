-- #715: the 10-year retention reaper. The half of the controller's 2026-09-07 ruling (#184) that
-- #107 deliberately left unbuilt.
--
-- 20260908071656's header says it plainly: "the 10-year reaper that finally drops the
-- pseudonymised rows is a follow-up. Nothing here encodes a window, so there is still no number
-- to invent." The number has since been ruled, so this migration invents nothing either — it
-- encodes the number ONCE, in `gdpr_retention_window()`, and every table reads it from there.
--
-- ── What the window is, and why it is ten years ────────────────────────────────────────────
--
--   * art. 2220 c.c. — the imprenditore keeps the accounting books and the originals of every
--     invoice, letter and receipt for TEN YEARS from the last entry.
--   * DPR 600/1973 art. 22 — the same ten years, from the tax side, running from the filing of
--     the return for the period the record belongs to.
--
-- Ten years is therefore a FLOOR imposed on us, not a retention preference: until it expires we
-- may not delete a payment record even when the member asks, which is exactly why erasure
-- pseudonymises these rows instead of dropping them. Once it expires the obligation is gone and
-- Art. 5(1)(e) storage limitation takes over — the row must go. This job is that second half.
--
-- The window runs from `erased_at`, NOT from `created_at`: the clock the law cares about is the
-- accounting one, but the only rows this job may touch are the erased ones, and erasure always
-- happens at or after the transaction. Reading the erasure stamp is therefore never earlier than
-- the legal floor, and it keeps the predicate honest — a row with no `erased_at` is a LIVE
-- record and is untouchable at any age.
--
-- ── `fund_contributions` gains `erased_at` (the 2026-09-09 ruling) ─────────────────────────
--
-- The other two retained tables already carry the column (20260908071656). `fund_contributions`
-- does not, because 20260815131925 (#240) pseudonymised it a different way — reassigning
-- `profile_id` to `gdpr_tombstone_profile_id()` rather than nulling it, since `profile_id` is
-- NOT NULL there. That left it the one retained table with no clock. Marco's ruling:
--
--   fund_contributions gains `erased_at`, backfilled from `updated_at` for rows already
--   pointing at the tombstone — the touch trigger stamped the reassignment.
--
-- The backfill's premise is sound in the direction that matters. `gdpr_erase_fund_footprint`
-- reassigns with a bare `update … set profile_id = v_tombstone` (20260815131925:91-96) and
-- `fund_contributions_touch_updated_at` (20260618153032:27-29) fires on it, so `updated_at` is
-- at least the erasure instant. It is not exactly it: `reverseContribution`
-- (supabase/functions/stripe-webhook/handlers.ts:342-360) matches on
-- `stripe_payment_intent_id` + `status = 'succeeded'` with no tombstone guard, so a refund or a
-- dispute landing AFTER an erasure moves `updated_at` forward again. That error is one-way — it
-- can only push the reap date later, never earlier — so the backfill over-retains in the worst
-- case and never under-retains. Over-retention by a few days on a ten-year window is the safe
-- side of a legal floor; under-retention would be the violation.
--
-- The backfill is only half of it: `gdpr_erase_fund_footprint` is re-signed here to STAMP
-- `erased_at` as it tombstones, because a row erased after this migration would otherwise carry
-- a NULL stamp — and a NULL stamp is untouchable by design. Without §2b the reaper would be
-- correct and would reap nothing but the rows that predate it.
--
-- ── Why a hard DELETE is safe here, table by table (verified against the tree, not assumed) ──
--
--   fund_contributions   zero inbound FKs; two triggers, both BEFORE UPDATE (touch +
--                        fund_contributions_freeze_edition, 20260815175549:108-112). Nothing
--                        cascades, nothing fires. The one casualty is arithmetic — see below.
--   circle_memberships   zero inbound FKs, no member-count cache (`entitlements` is a live
--                        security_invoker view, 20260618204459:41-58), one BEFORE UPDATE touch
--                        trigger. A plain DELETE is inert.
--   event_tickets        ONE inbound FK: event_attendance.ticket_id ON DELETE CASCADE
--                        (20260616014758:10). Deleting a reaped ticket takes its check-in row
--                        with it. That is deliberate — see the next block.
--
-- ── The `event_attendance` cascade is intended, and this is the reasoning ──────────────────
--
-- 20260908084858 went out of its way to keep `event_attendance` alive through an ORGANISER's
-- erasure, repointing `scanned_by` at the sentinel rather than letting the cascade take it, and
-- MIGRATIONS-ERRATA.md's entry for it names the check-in as one of the three things that
-- survive. None of that is contradicted here, because it was protecting those rows from an
-- erasure-time cascade, not from retention expiry:
--
--   * the row's subject is the ERASED member's own attendance — they were at event X on date Y.
--     Its retention basis is weaker than the payment record's, not stronger: it is not an
--     accounting record at all, so art. 2220 never covered it. It outlives the ten years only
--     because it hangs off a row that did.
--   * no live reader loses anything. Both consumers join through `event_tickets.user_id` —
--     `profile_stat_counts` (20260704085845:28-31) and the momenti co-attendance term
--     (20260817165404:179-181) — and that column was nulled at erasure, so a reaped ticket
--     already contributes to nobody's count. Deleting it moves no number.
--   * it is already unreadable in practice. `event_attendance_select_holder_or_organizer`
--     resolves to the organiser or the ticket holder; the holder is NULL, and if the organiser
--     was erased too, `events.organizer_id` is the sentinel.
--
-- So the cascade is data minimisation finishing a job, not collateral damage. The pgTAP test
-- asserts the attendance row goes WITH the ticket, so a future ON DELETE change is caught.
--
-- ── The one real consequence: `raised_cents` is a live SUM ─────────────────────────────────
--
-- `recompute_fund_aggregate` (20260815131925:136-153, body re-read off staging rather than
-- trusted from the file) is `coalesce(sum(amount_cents), 0)` over `status = 'succeeded'`. There
-- is no cached per-edition counter to keep in step — the total IS the rows. Its own header
-- says "raised_cents keeps every cent (erased members' money is retained by D50)".
--
-- Deleting reaped rows breaks that, and not at reap time: `fund_aggregates` stays correct until
-- something recomputes that edition, and then the historic ticker silently drops by the reaped
-- amount. The trigger for that is not hypothetical — `gdpr_erase_fund_footprint` recomputes
-- every edition it touches, so a member erased in 2036 who also gave to the 2026 edition
-- rewrites the 2026 total using only the rows that have not yet aged out.
--
-- `fund_editions.reaped_cents` is the carry that keeps the invariant literal. The reaper adds
-- the deleted `amount_cents` to it in the SAME statement that deletes the rows, and
-- `recompute_fund_aggregate` adds it back in. Every cent raised stays raised, forever, while the
-- row it came from is gone. Only `status = 'succeeded'` rows are carried, because those are the
-- only ones the sum ever counted.
--
-- `contributor_count` deliberately does NOT get the same treatment. It already excludes the
-- sentinel by design (20260815131925:127-135 — "distinct identifiable contributors"), so every
-- row this job deletes was already uncounted. Carrying it would inflate it.
--
-- Writing the carry fires `fund_editions_touch_updated_at` and nothing else: all three freeze
-- triggers on that table (`fund_editions_freeze_announcement`, `_freeze_declarations`,
-- `fund_editions_ballot_open`, read off staging) carry WHEN clauses gated on `phase`,
-- `confirmed_pool_cents`, `winner_confirmed_at`, `split_pct`, `cost_fee_statement` and
-- `equity_declared` — none of which this touches. So a reap bumps a decade-old edition's
-- `updated_at` and changes nothing else.
--
-- ── Out of scope, and why ──────────────────────────────────────────────────────────────────
--
--   fund_payout_ledger      genuinely carries no identity: `destination_account_id` is `text`
--                           and deliberately not an FK (20260815215924:36-52).
--   stripe_webhook_events   NOT identity-free, whatever a column list suggests: `payload` stores
--                           the whole Stripe event, so customer email, name, address and
--                           `metadata.profile_id` sit in the JSON, and no erasure path touches
--                           it. It is out of scope because pseudonymising it needs its own
--                           design (the table is rule 6's dedupe guard), not because it is
--                           clean. Filed separately.
--
-- ── When anything actually happens ─────────────────────────────────────────────────────────
--
-- Nothing. The first erasure ran 2026-08-15, so the earliest possible reap is 2036-08-15, and
-- the job is a no-op scan until then. That is the point: it must exist and be correct a decade
-- before it first matters, because nobody will be watching on the day it fires.

-- ── 1. the window, in one place ─────────────────────────────────────────────────────────────
-- IMMUTABLE and argument-free so it inlines into the predicate and the planner can still use the
-- partial indexes below. Changing the number means a new migration, which is the point: a
-- retention window that can be edited quietly is not a policy.
create or replace function public.gdpr_retention_window()
returns interval
language sql
immutable
set search_path = ''
as $$
  select interval '10 years';
$$;

comment on function public.gdpr_retention_window() is
  'The GDPR retention floor for pseudonymised payment records: 10 years (art. 2220 c.c.; DPR 600/1973 art. 22), per the controller ruling on #184. The single home for the number — gdpr_retention_reap() and every test read it from here. Service-role only.';

revoke execute on function public.gdpr_retention_window() from public, anon, authenticated;
grant execute on function public.gdpr_retention_window() to service_role;

-- ── 2. fund_contributions.erased_at + the ruled backfill ────────────────────────────────────
alter table public.fund_contributions
  add column erased_at timestamptz;

comment on column public.fund_contributions.erased_at is
  'When a GDPR erasure pseudonymised this row (#715). NULL for a live contribution. Same 10-year window as event_tickets.erased_at and circle_memberships.erased_at, and the same reaper. Backfilled from updated_at for rows already tombstoned when the column landed.';

-- Backfilled from `updated_at`, per the 2026-09-09 ruling: the touch trigger stamped the
-- reassignment. `profile_id = tombstone` is the whole population — the sentinel is only ever
-- written by `gdpr_erase_fund_footprint`. Guarded on `erased_at is null` so it is a no-op on a
-- replay, though on a from-zero replay the column is new and the table empty.
update public.fund_contributions
   set erased_at = updated_at
 where profile_id = public.gdpr_tombstone_profile_id()
   and erased_at is null;

-- ── 2b. and every FUTURE erasure stamps it ──────────────────────────────────────────────────
-- The backfill above covers only the rows tombstoned before this migration. Without this, an
-- erasure running tomorrow would tombstone a row and leave `erased_at` NULL — and a NULL
-- `erased_at` is untouchable by design, so that row would never age out. The reaper would work
-- perfectly and reap nothing but history.
--
-- Body preserved verbatim from 20260815131925:73-120 except for the `erased_at` term in (a).
-- `coalesce(erased_at, v_now)` matches 20260908071656's pattern: a re-run of an already-erased
-- request cannot move the retention clock forward, so a retry never buys the row another decade.
-- Same signature, same SECURITY INVOKER, ACL restated after `create or replace`.
create or replace function public.gdpr_erase_fund_footprint(p_profile_id uuid)
returns table (bucket_id text, name text)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_tombstone uuid := public.gdpr_tombstone_profile_id();
  v_now timestamptz := now();
  v_editions uuid[];
  v_edition uuid;
begin
  if p_profile_id = v_tombstone then
    raise exception 'refusing to erase the tombstone sentinel itself';
  end if;

  -- (a) pseudonymize money rows, then refresh the aggregates their editions cache —
  -- reassignment changes contributor_count's population, and the next webhook event
  -- for the edition may be far away.
  with moved as (
    update public.fund_contributions
       set profile_id = v_tombstone,
           erased_at  = coalesce(erased_at, v_now)
     where profile_id = p_profile_id
    returning edition_id
  )
  select array_agg(distinct m.edition_id) into v_editions from moved m;

  if v_editions is not null then
    foreach v_edition in array v_editions loop
      perform public.recompute_fund_aggregate(v_edition);
    end loop;
  end if;

  -- (b) the erased member's own votes; (c) their candidacies, which cascade every vote
  -- cast on them (candidacy_votes.candidacy_id ON DELETE CASCADE, 20260618131250).
  delete from public.candidacy_votes where voter_id = p_profile_id;
  delete from public.dream_candidacies where profile_id = p_profile_id;

  -- (d) the blob-removal manifest for the erasure-job (whole folder: every candidacy
  -- video + poster the member ever wrote lives under their uid prefix, per the bucket's
  -- owner-write policies).
  return query
    select o.bucket_id, o.name
      from storage.objects o
     where o.bucket_id = 'candidacy-videos'
       and o.name like p_profile_id::text || '/%';
end;
$$;

comment on function public.gdpr_erase_fund_footprint(uuid) is
  'GDPR erasure, fund tables (#240): tombstone-reassign fund_contributions and stamp erased_at for the 10-year reaper (#715), recompute touched aggregates, delete candidacy_votes + dream_candidacies, return the candidacy-videos blob manifest for the erasure-job to remove via the Storage API. Service-role only; idempotent.';

revoke all on function public.gdpr_erase_fund_footprint(uuid) from public, anon, authenticated;
grant execute on function public.gdpr_erase_fund_footprint(uuid) to service_role;

-- ── 3. fund_editions.reaped_cents — the carry that keeps `raised_cents` whole ───────────────
alter table public.fund_editions
  add column reaped_cents bigint not null default 0,
  add constraint fund_editions_reaped_cents_check check (reaped_cents >= 0);

comment on column public.fund_editions.reaped_cents is
  '#715: the sum of amount_cents from succeeded contributions the 10-year retention reaper has deleted from this edition. Monotonically increasing. recompute_fund_aggregate adds it to the live SUM so raised_cents keeps every cent (20260815131925:127-135) even after the rows are gone. Never decremented; written only by gdpr_retention_reap().';

-- ── 4. recompute_fund_aggregate reads the carry ─────────────────────────────────────────────
-- Body preserved verbatim from 20260815131925:136-153 except for the `+ reaped_cents` term and
-- the join that supplies it. The sentinel filter on contributor_count is unchanged and must
-- stay: reaped rows were already excluded from that count, so the carry applies to cents only.
-- ACL set restated after `create or replace` (the 20260821082216 precaution).
create or replace function public.recompute_fund_aggregate(p_edition_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.fund_aggregates (edition_id, raised_cents, contributor_count, updated_at)
  select p_edition_id,
         coalesce(sum(c.amount_cents), 0)
           + coalesce((select e.reaped_cents from public.fund_editions e where e.id = p_edition_id), 0),
         count(distinct c.profile_id)
           filter (where c.profile_id <> public.gdpr_tombstone_profile_id()),
         now()
  from public.fund_contributions c
  where c.edition_id = p_edition_id and c.status = 'succeeded'
  on conflict (edition_id) do update
    set raised_cents = excluded.raised_cents,
        contributor_count = excluded.contributor_count,
        updated_at = now();
$$;

comment on function public.recompute_fund_aggregate(uuid) is
  'Recompute fund_aggregates from succeeded fund_contributions (rule #6 webhook cache), PLUS fund_editions.reaped_cents so the 10-year reaper (#715) cannot shrink a historic total; contributor_count excludes the GDPR tombstone sentinel. Service-role only.';

revoke all on function public.recompute_fund_aggregate(uuid) from public, anon, authenticated;
grant execute on function public.recompute_fund_aggregate(uuid) to service_role;

-- ── 5. the predicate's indexes ──────────────────────────────────────────────────────────────
-- Partial on `erased_at is not null`: the reaped population is a rounding error beside the live
-- one and will be for years, so a full index would be almost entirely dead entries. Without
-- these the nightly pass is three seq scans that find nothing.
create index if not exists fund_contributions_erased_at_idx
  on public.fund_contributions (erased_at) where erased_at is not null;
create index if not exists event_tickets_erased_at_idx
  on public.event_tickets (erased_at) where erased_at is not null;
create index if not exists circle_memberships_erased_at_idx
  on public.circle_memberships (erased_at) where erased_at is not null;

-- ── 6. the reaper ───────────────────────────────────────────────────────────────────────────
-- SECURITY INVOKER: the cron job runs as the table owner and needs no borrowed rights, and
-- service_role bypasses RLS anyway. That is the 20260821082216 correction — a definer here would
-- be an unnecessary privileged surface.
--
-- Returns per-table counts so an operator can see what a pass did; the erasure job does not call
-- it, and nothing consumes the result today.
--
-- `erased_at is not null` is stated explicitly beside the `<` comparison even though the
-- comparison alone would exclude NULLs. It is the load-bearing clause — a LIVE row is
-- untouchable at any age — and `IF <null>` failing open is a trap this repo has already been
-- bitten by. Stating it also lets the planner match the partial indexes.
create or replace function public.gdpr_retention_reap()
returns table (reaped_table text, rows_deleted bigint)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_cutoff timestamptz := now() - public.gdpr_retention_window();
  v_tombstone uuid := public.gdpr_tombstone_profile_id();
  v_tickets bigint;
  v_memberships bigint;
  v_contributions bigint;
begin
  -- fund_contributions: the carry and the delete are ONE statement, so there is no window in
  -- which the rows are gone and the cents are not yet recorded. A data-modifying CTE always
  -- runs to completion whether or not the outer query reads it.
  with reaped as (
    delete from public.fund_contributions
     where profile_id = v_tombstone
       and erased_at is not null
       and erased_at < v_cutoff
    returning edition_id, amount_cents, status
  ), carried as (
    update public.fund_editions e
       set reaped_cents = e.reaped_cents + agg.sum_cents
      from (
        select r.edition_id, sum(r.amount_cents) as sum_cents
          from reaped r
         where r.status = 'succeeded'
         group by r.edition_id
      ) agg
     where e.id = agg.edition_id
    returning 1
  )
  select count(*) into v_contributions from reaped;

  -- event_tickets: `event_attendance.ticket_id` cascades. Intended — see the header.
  delete from public.event_tickets
   where erased_at is not null
     and erased_at < v_cutoff;
  get diagnostics v_tickets = row_count;

  delete from public.circle_memberships
   where erased_at is not null
     and erased_at < v_cutoff;
  get diagnostics v_memberships = row_count;

  return query
    select 'fund_contributions'::text, v_contributions
    union all select 'event_tickets'::text, v_tickets
    union all select 'circle_memberships'::text, v_memberships;
end;
$$;

comment on function public.gdpr_retention_reap() is
  'The 10-year retention reaper (#715): deletes pseudonymised rows from fund_contributions, event_tickets and circle_memberships once erased_at is older than gdpr_retention_window(). Never touches a row with a NULL erased_at, however old. Carries the deleted cents to fund_editions.reaped_cents so raised_cents keeps every cent. Run nightly by the gdpr-retention-reap cron job. Service-role only.';

revoke execute on function public.gdpr_retention_reap() from public, anon, authenticated;
grant execute on function public.gdpr_retention_reap() to service_role;

-- ── 7. the schedule ─────────────────────────────────────────────────────────────────────────
-- Pure SQL, so no wrapper and no pg_net: this job deletes database rows and touches no Storage
-- API and no KV. `invoke_*` + a Vault key would be a key to rotate for no reason.
--
-- 04:53 UTC: clear of the 03:11/03:17 cluster, erasure-nightly at 03:47, purge-waitlist at
-- 04:00, reap-post-media-bytes at 04:29, fund-settle at 04:41, the */15 sweeps and the hourly
-- push-receipt sweep at :23. After erasure-nightly on purpose — a request erased tonight should
-- have its stamp before the reaper reads it, even though the two are ten years apart.
--
-- Unschedule-if-present then schedule, so the migration replays cleanly from zero and is
-- re-runnable on a hosted project.
create extension if not exists pg_cron;

select cron.unschedule(jobid) from cron.job where jobname = 'gdpr-retention-reap';
select cron.schedule(
  'gdpr-retention-reap',
  '53 4 * * *',
  $$ select public.gdpr_retention_reap() $$
);
