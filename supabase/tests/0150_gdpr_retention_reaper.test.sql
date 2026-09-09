-- #715 — the 10-year retention reaper (20260909085841). The half of the controller's ruling
-- (#184) that 20260908071656 deliberately left unbuilt, and that 0149's closing note names as
-- untestable until it landed: "NOT asserted here, because nothing implements it: the ten-year
-- window itself."
--
-- Six claims, and each one is a way this could be silently wrong for a decade:
--
--   1. THE NUMBER IS TEN YEARS, AND IT LIVES IN ONE PLACE. Asserted BY VALUE, not by reading a
--      comment — `gdpr_retention_window()` is the only home for it, and §1 fails if anyone
--      changes it without changing this file, or adds a second copy elsewhere.
--   2. INSIDE THE WINDOW SURVIVES, OUTSIDE IT DOES NOT. §4 puts a row on each side of the
--      boundary in all three tables and reaps once.
--   3. A LIVE ROW IS UNTOUCHABLE AT ANY AGE. §4's live rows are older than the window and have a
--      NULL `erased_at`. This is the assertion that matters most: the failure mode here is not a
--      missed deletion, it is deleting a paying member's records.
--   4. EVERY CENT RAISED STAYS RAISED. `raised_cents` is a live `sum(amount_cents)`, so deleting
--      rows would shrink a historic public total the next time anything recomputed that edition.
--      §5 recomputes AFTER the reap and asserts the total is unchanged — the `reaped_cents` carry
--      doing its job. A test that only checked the reap would never see this.
--   5. THE CASCADE IS THE INTENDED ONE. `event_attendance.ticket_id` is ON DELETE CASCADE, so a
--      reaped ticket takes its check-in with it. §6 asserts that happens AND that a live
--      ticket's check-in is untouched, so a future change to either FK is caught here.
--   6. AND A FUTURE ERASURE STAMPS THE CLOCK. The migration's backfill covers only the rows
--      tombstoned before it. §6b erases a member for real and asserts `erased_at` lands — if
--      `gdpr_erase_fund_footprint` ever stops stamping it, every row erased from then on becomes
--      immortal and the reaper stays green while reaping nothing.
--
-- §7 is the schedule. §2 is the grant/definer/volatility surface for the two new functions.
--
-- Nothing in production can age out before 2036-08-15 (the first erasure ran 2026-08-15), so
-- every fixture below sets `erased_at` explicitly. There is no frozen-clock helper in this repo;
-- `now() - interval '…'` inserts are the convention (0126, 0139).
--
-- Two fixture notes:
--   * setting `erased_at` on `fund_contributions` via UPDATE would also move `updated_at` through
--     `fund_contributions_touch_updated_at`, so every row carries its stamp in the INSERT itself.
--   * the edition is `closed`, both because a decade-old cycle would be and because
--     `fund_editions_one_active` is a unique index over non-closed rows — a `candidacy` fixture
--     would collide with any other open edition in the database.

begin;

create extension if not exists pgtap with schema extensions;

select plan(56);

-- ── 1. the window: one home, and the number is ten years ─────────────────────────────────
select has_function('public', 'gdpr_retention_window', '{}'::name[],
  'gdpr_retention_window() exists — the single home for the retention number');
select is(
  public.gdpr_retention_window(),
  interval '10 years',
  'the window is TEN YEARS — art. 2220 c.c. and DPR 600/1973 art. 22, per the controller ruling on #184');
select volatility_is('public', 'gdpr_retention_window', '{}'::name[], 'immutable',
  'gdpr_retention_window is IMMUTABLE so it inlines into the reaper''s predicate and the partial indexes stay usable');
select is(
  (select proconfig from pg_proc
    where oid = 'public.gdpr_retention_window()'::regprocedure),
  array['search_path=""'], 'gdpr_retention_window locks search_path to empty');

-- The number must not be spelled twice. Two copies drift, and only one gets the next ruling.
select is(
  (select count(*)::int from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname <> 'gdpr_retention_window'
     and p.prosrc like '%10 years%'),
  0,
  'no other public function spells the window — gdpr_retention_window() is the only copy in the schema');

-- ── 2. the new surface: grants, definer posture, search_path, indexes ─────────────────────
select has_function('public', 'gdpr_retention_reap', '{}'::name[], 'gdpr_retention_reap() exists');
select isnt_definer('public', 'gdpr_retention_reap', '{}'::name[],
  'gdpr_retention_reap is security INVOKER — cron runs as the owner and service_role bypasses RLS, so definer rights would add only risk (the 20260821082216 correction)');
select is(
  (select proconfig from pg_proc
    where oid = 'public.gdpr_retention_reap()'::regprocedure),
  array['search_path=""'], 'gdpr_retention_reap locks search_path to empty');

select ok(not has_function_privilege('anon', 'public.gdpr_retention_reap()', 'execute'),
  'anon cannot run the reaper');
select ok(not has_function_privilege('authenticated', 'public.gdpr_retention_reap()', 'execute'),
  'authenticated cannot run the reaper — a member must not be able to delete retained financial records');
select ok(not has_function_privilege('public', 'public.gdpr_retention_reap()', 'execute'),
  'public cannot run the reaper');
select ok(has_function_privilege('service_role', 'public.gdpr_retention_reap()', 'execute'),
  'service_role can');
select ok(not has_function_privilege('anon', 'public.gdpr_retention_window()', 'execute'),
  'anon cannot read the window');
select ok(not has_function_privilege('authenticated', 'public.gdpr_retention_window()', 'execute'),
  'authenticated cannot read the window');

select has_column('public', 'fund_contributions', 'erased_at',
  'fund_contributions carries erased_at — the clock the 2026-09-09 ruling added, and the one retained table that had none');
select col_is_null('public', 'fund_contributions', 'erased_at',
  'erased_at is nullable: NULL means a LIVE contribution');
select has_column('public', 'fund_editions', 'reaped_cents', 'fund_editions carries reaped_cents');
select col_not_null('public', 'fund_editions', 'reaped_cents',
  'reaped_cents is NOT NULL — arithmetic on a NULL carry would silently zero a historic total');

-- Partial, because the reaped population is a rounding error beside the live one and will be for
-- years. Without these the nightly pass is three seq scans that find nothing.
select is(
  (select indexdef from pg_indexes
    where schemaname = 'public' and indexname = 'fund_contributions_erased_at_idx'),
  'CREATE INDEX fund_contributions_erased_at_idx ON public.fund_contributions USING btree (erased_at) WHERE (erased_at IS NOT NULL)',
  'fund_contributions_erased_at_idx is PARTIAL on erased_at is not null');
select is(
  (select indexdef from pg_indexes
    where schemaname = 'public' and indexname = 'event_tickets_erased_at_idx'),
  'CREATE INDEX event_tickets_erased_at_idx ON public.event_tickets USING btree (erased_at) WHERE (erased_at IS NOT NULL)',
  'event_tickets_erased_at_idx is PARTIAL');
select is(
  (select indexdef from pg_indexes
    where schemaname = 'public' and indexname = 'circle_memberships_erased_at_idx'),
  'CREATE INDEX circle_memberships_erased_at_idx ON public.circle_memberships USING btree (erased_at) WHERE (erased_at IS NOT NULL)',
  'circle_memberships_erased_at_idx is PARTIAL');

-- ── 3. fixture: rows on both sides of the boundary, plus rows that must never move ────────
-- OLD   = erased 11 years ago → past the window, must be reaped.
-- YOUNG = erased 9 years ago  → inside the window, must survive. Nine years is deliberate: a
--         fixture at "yesterday" would also pass a predicate comparing the wrong unit.
-- LIVE  = erased_at NULL, one of them created 12 years ago → must survive forever.

insert into auth.users (instance_id, id, aud, role, email, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', '50000000-0000-0000-0000-0000000000aa',
   'authenticated', 'authenticated', 'reap-a@test.athanor', '{"locale":"it"}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '50000000-0000-0000-0000-0000000000cc',
   'authenticated', 'authenticated', 'reap-c@test.athanor', '{"locale":"it"}'::jsonb, now(), now());

insert into public.fund_editions
  (id, target_at, goal_cents, phase, closure_reason, min_funding_cents, min_voters,
   min_candidacies, split_pct, cost_fee_statement, equity_declared)
values ('50000000-0000-0000-0000-0000000000ed', now() - interval '11 years', 5000000, 'closed',
        'realized', 100000, 5, 3, 10, 'fixture costs statement', 'none');

select is(
  (select reaped_cents from public.fund_editions where id = '50000000-0000-0000-0000-0000000000ed'),
  0::bigint,
  'a fresh edition starts with reaped_cents 0 — the column defaults, so no backfill was needed for it');

-- Four contributions on one edition. amount_cents has a >= 100 floor, so every value clears it.
insert into public.fund_contributions
  (id, edition_id, profile_id, amount_cents, stripe_checkout_session_id, status, erased_at)
values
  -- past the window and succeeded: reaped, and its 700 cents must survive in reaped_cents
  ('50000000-0000-0000-0000-000000000f01', '50000000-0000-0000-0000-0000000000ed',
   public.gdpr_tombstone_profile_id(), 700, 'cs_reap_old', 'succeeded', now() - interval '11 years'),
  -- past the window but refunded: reaped too, and must NOT be carried — raised_cents never
  -- counted it, so carrying it would invent money.
  ('50000000-0000-0000-0000-000000000f02', '50000000-0000-0000-0000-0000000000ed',
   public.gdpr_tombstone_profile_id(), 400, 'cs_reap_refunded', 'refunded', now() - interval '11 years'),
  -- inside the window
  ('50000000-0000-0000-0000-000000000f03', '50000000-0000-0000-0000-0000000000ed',
   public.gdpr_tombstone_profile_id(), 900, 'cs_reap_young', 'succeeded', now() - interval '9 years'),
  -- LIVE: a real member, no erasure stamp. Untouchable.
  ('50000000-0000-0000-0000-000000000f04', '50000000-0000-0000-0000-0000000000ed',
   '50000000-0000-0000-0000-0000000000cc', 1300, 'cs_reap_live', 'succeeded', null);

-- A LIVE contribution OLDER than the window by created_at, to prove the predicate reads
-- erased_at and never the transaction date.
insert into public.fund_contributions
  (id, edition_id, profile_id, amount_cents, stripe_checkout_session_id, status, erased_at, created_at)
values ('50000000-0000-0000-0000-000000000f05', '50000000-0000-0000-0000-0000000000ed',
        '50000000-0000-0000-0000-0000000000cc', 100, 'cs_reap_ancient', 'succeeded',
        null, now() - interval '12 years');

insert into public.events (id, organizer_id, title, category, is_online, venue, geo, starts_at, price_cents)
values ('50000000-0000-0000-0000-0000000000e1', '50000000-0000-0000-0000-0000000000cc',
        'Cerchio di prova', 'networking', false, 'Cascina Cuccagna',
        extensions.st_point(9.2, 45.45)::extensions.geography, now() - interval '11 years', 0);

-- The two reaped tickets are pseudonymised the 20260908071656 way: user_id and qr_token NULL,
-- erased_at stamped. The live one belongs to C.
insert into public.event_tickets (id, user_id, event_id, stripe_payment_id, qr_token, status, erased_at)
values
  ('50000000-0000-0000-0000-000000000101', null, '50000000-0000-0000-0000-0000000000e1',
   'pi_reap_old', null, 'paid', now() - interval '11 years'),
  ('50000000-0000-0000-0000-000000000102', null, '50000000-0000-0000-0000-0000000000e1',
   'pi_reap_young', null, 'paid', now() - interval '9 years'),
  ('50000000-0000-0000-0000-000000000103', '50000000-0000-0000-0000-0000000000cc',
   '50000000-0000-0000-0000-0000000000e1', 'pi_reap_live', 'qr_reap_live', 'paid', null);

-- Check-ins on the OLD (to be reaped) and the LIVE ticket, both scanned by the organiser C.
insert into public.event_attendance (ticket_id, event_id, scanned_by)
values
  ('50000000-0000-0000-0000-000000000101', '50000000-0000-0000-0000-0000000000e1',
   '50000000-0000-0000-0000-0000000000cc'),
  ('50000000-0000-0000-0000-000000000103', '50000000-0000-0000-0000-0000000000e1',
   '50000000-0000-0000-0000-0000000000cc');

insert into public.circle_memberships
  (id, profile_id, stripe_customer_id, stripe_subscription_id, plan, status, erased_at)
values
  ('50000000-0000-0000-0000-000000000201', null, 'cus_reap_old', 'sub_reap_old',
   'monthly', 'canceled', now() - interval '11 years'),
  ('50000000-0000-0000-0000-000000000202', null, 'cus_reap_young', 'sub_reap_young',
   'annual', 'canceled', now() - interval '9 years'),
  ('50000000-0000-0000-0000-000000000203', '50000000-0000-0000-0000-0000000000aa',
   'cus_reap_live', 'sub_reap_live', 'monthly', 'active', null);

-- The pool BEFORE anything is reaped: 700 + 900 + 1300 + 100 = 3000. The refunded 400 is not
-- counted. This is the number §5 asserts is still true once two of those rows no longer exist.
select public.recompute_fund_aggregate('50000000-0000-0000-0000-0000000000ed');
select is(
  (select raised_cents from public.fund_aggregates
    where edition_id = '50000000-0000-0000-0000-0000000000ed'),
  3000::bigint,
  'before the reap: raised_cents is 3000 (700 + 900 + 1300 + 100; the refunded 400 never counted)');

-- ── 4. one pass ───────────────────────────────────────────────────────────────────────────
create temporary table reap_result as select * from public.gdpr_retention_reap();

select is(
  (select rows_deleted from reap_result where reaped_table = 'fund_contributions'),
  2::bigint, 'the pass reports 2 contributions deleted — the succeeded one AND the refunded one');
select is(
  (select rows_deleted from reap_result where reaped_table = 'event_tickets'),
  1::bigint, 'the pass reports 1 ticket deleted');
select is(
  (select rows_deleted from reap_result where reaped_table = 'circle_memberships'),
  1::bigint, 'the pass reports 1 membership deleted');

-- outside the window: gone
select is_empty(
  $$select 1 from public.fund_contributions where id = '50000000-0000-0000-0000-000000000f01'$$,
  'the contribution erased 11 years ago is gone');
select is_empty(
  $$select 1 from public.fund_contributions where id = '50000000-0000-0000-0000-000000000f02'$$,
  'the refunded contribution erased 11 years ago is gone too — the window is the whole test, not the status');
select is_empty(
  $$select 1 from public.event_tickets where id = '50000000-0000-0000-0000-000000000101'$$,
  'the ticket erased 11 years ago is gone');
select is_empty(
  $$select 1 from public.circle_memberships where id = '50000000-0000-0000-0000-000000000201'$$,
  'the membership erased 11 years ago is gone');

-- inside the window: survives
select isnt_empty(
  $$select 1 from public.fund_contributions where id = '50000000-0000-0000-0000-000000000f03'$$,
  'the contribution erased 9 years ago SURVIVES — inside the window');
select isnt_empty(
  $$select 1 from public.event_tickets where id = '50000000-0000-0000-0000-000000000102'$$,
  'the ticket erased 9 years ago SURVIVES');
select isnt_empty(
  $$select 1 from public.circle_memberships where id = '50000000-0000-0000-0000-000000000202'$$,
  'the membership erased 9 years ago SURVIVES');

-- LIVE rows: untouchable at any age. The worst failure this file exists to catch.
select isnt_empty(
  $$select 1 from public.fund_contributions where id = '50000000-0000-0000-0000-000000000f04'$$,
  'a LIVE contribution survives — erased_at IS NULL, so it is untouchable');
select isnt_empty(
  $$select 1 from public.fund_contributions where id = '50000000-0000-0000-0000-000000000f05'$$,
  'a LIVE contribution created 12 YEARS ago survives — the predicate reads erased_at, never created_at');
select isnt_empty(
  $$select 1 from public.event_tickets where id = '50000000-0000-0000-0000-000000000103'$$,
  'a LIVE ticket survives');
select isnt_empty(
  $$select 1 from public.circle_memberships where id = '50000000-0000-0000-0000-000000000203'$$,
  'a LIVE membership survives');

-- ── 5. every cent raised stays raised ─────────────────────────────────────────────────────
-- The carry is written in the SAME statement as the delete, so it is already correct here — no
-- second pass, no reconciliation job, no window in which the rows are gone and the cents are not.
select is(
  (select reaped_cents from public.fund_editions where id = '50000000-0000-0000-0000-0000000000ed'),
  700::bigint,
  'reaped_cents carries the 700 succeeded cents — and NOT the refunded 400, which raised_cents never counted');

-- The whole point. `gdpr_erase_fund_footprint` recomputes every edition it touches, so an
-- unrelated erasure a decade from now runs this line against an edition whose old rows are gone.
-- Without the carry, the public historic total silently drops by 700.
select public.recompute_fund_aggregate('50000000-0000-0000-0000-0000000000ed');
select is(
  (select raised_cents from public.fund_aggregates
    where edition_id = '50000000-0000-0000-0000-0000000000ed'),
  3000::bigint,
  'after the reap AND a recompute: raised_cents is still 3000 — 20260815131925''s "raised_cents keeps every cent" survives the reaper');

-- contributor_count must NOT be inflated by the carry: the reaped rows were tombstoned, and the
-- sentinel was already excluded from that count, so the only contributor left is C.
select is(
  (select contributor_count from public.fund_aggregates
    where edition_id = '50000000-0000-0000-0000-0000000000ed'),
  1::bigint,
  'contributor_count is 1 (member C only) — the carry is cents-only, and the sentinel stays excluded');

-- A second pass must change nothing, and must not double the carry.
select lives_ok($$select public.gdpr_retention_reap()$$, 'a second pass runs clean');
select is(
  (select reaped_cents from public.fund_editions where id = '50000000-0000-0000-0000-0000000000ed'),
  700::bigint, 'a second pass does not double the carry — the rows it would count are already gone');

-- ── 6. the event_attendance cascade is the intended one ───────────────────────────────────
-- Deliberate, and reasoned in the migration header: the check-in is the erased member's own
-- attendance, its retention basis is weaker than the payment record's (art. 2220 never covered
-- it), and both live consumers join through the already-NULL event_tickets.user_id, so no live
-- number moves. Asserted so a future change to either FK is caught here rather than in 2036.
select is_empty(
  $$select 1 from public.event_attendance where ticket_id = '50000000-0000-0000-0000-000000000101'$$,
  'the reaped ticket''s check-in went with it — ON DELETE CASCADE, intended (see the migration header)');
select isnt_empty(
  $$select 1 from public.event_attendance where ticket_id = '50000000-0000-0000-0000-000000000103'$$,
  'the LIVE ticket''s check-in is untouched — the cascade reached exactly one row');
select is(
  (select confdeltype::text from pg_constraint
    where conrelid = 'public.event_attendance'::regclass
      and confrelid = 'public.event_tickets'::regclass),
  'c',
  'event_attendance.ticket_id is still ON DELETE CASCADE — the cascade above is by design, not by accident');

select isnt_empty(
  $$select 1 from public.events where id = '50000000-0000-0000-0000-0000000000e1'$$,
  'the event survives — the reaper deletes retained payment rows, never content');

-- ── 6b. and a future erasure stamps the clock ─────────────────────────────────────────────
-- The migration's backfill covers only rows tombstoned before it. If the erasure function ever
-- stops stamping erased_at, every row erased from then on becomes immortal: the reaper stays
-- green and reaps nothing but history.
insert into public.fund_contributions
  (id, edition_id, profile_id, amount_cents, stripe_checkout_session_id, status)
values ('50000000-0000-0000-0000-000000000f06', '50000000-0000-0000-0000-0000000000ed',
        '50000000-0000-0000-0000-0000000000aa', 250, 'cs_reap_future', 'succeeded');

select lives_ok(
  $$select * from public.gdpr_erase_fund_footprint('50000000-0000-0000-0000-0000000000aa')$$,
  'erasing a member who holds a contribution runs clean');
select is(
  (select profile_id from public.fund_contributions
    where id = '50000000-0000-0000-0000-000000000f06'),
  public.gdpr_tombstone_profile_id(),
  'the erased contribution is tombstoned, as 20260815131925 always did');
select ok(
  (select erased_at from public.fund_contributions
    where id = '50000000-0000-0000-0000-000000000f06') is not null,
  'and it now carries erased_at — without this the row would never age out');
select ok(
  (select erased_at from public.fund_contributions
    where id = '50000000-0000-0000-0000-000000000f06') > now() - interval '1 minute',
  'erased_at is stamped at the erasure instant, so the ten years start from the erasure');

-- A retry must not buy the row another decade.
create temporary table erased_stamp as
  select erased_at from public.fund_contributions
   where id = '50000000-0000-0000-0000-000000000f06';

select lives_ok(
  $$select * from public.gdpr_erase_fund_footprint('50000000-0000-0000-0000-0000000000aa')$$,
  'a re-run of the same erasure runs clean — idempotent');
select is(
  (select erased_at from public.fund_contributions
    where id = '50000000-0000-0000-0000-000000000f06'),
  (select erased_at from erased_stamp),
  'the re-run did not move erased_at — a retry cannot push the reap date forward');

-- ── 7. the schedule ───────────────────────────────────────────────────────────────────────
select is((select count(*)::int from cron.job where jobname = 'gdpr-retention-reap'), 1,
  'exactly one gdpr-retention-reap job — unschedule-then-schedule, so a replay adds no second');
select is(
  (select schedule from cron.job where jobname = 'gdpr-retention-reap'),
  '53 4 * * *',
  'the job runs at 04:53, clear of the 03:11/03:17 cluster, erasure-nightly at 03:47, purge-waitlist at 04:00, reap-post-media-bytes at 04:29 and fund-settle at 04:41');
select ok(
  (select command from cron.job where jobname = 'gdpr-retention-reap')
    like '%gdpr_retention_reap()%',
  'cron calls the reaper directly — pure SQL, so there is no wrapper and no key to rotate');
select ok(
  (select command from cron.job where jobname = 'gdpr-retention-reap')
    not like '%sb\_secret\_%',
  'no secret is baked into the cron command');

select * from finish();
rollback;
