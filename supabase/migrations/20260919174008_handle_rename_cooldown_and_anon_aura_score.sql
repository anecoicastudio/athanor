-- #782 — the @handle is the person's choice, renameable once every 30 days, and the Aura row a
-- signed-out caller can read shrinks to the score. Rulings 2026-09-19 (Marco), on the issue.
--
-- Until now the handle was the email's local part (`suggestHandle`, flushed after sign-up with a
-- random-suffix retry on a clash) and no screen could change it, so a member's public /@handle
-- URL carried the first half of their email address. From this release the app asks for the handle on its
-- own screen once the account exists — empty field, never prefilled — and the profile editor can
-- change it. Nothing in this file writes a handle: existing members keep theirs (no backfill, no
-- forced rename), and whoever holds an email-derived one gets the rename path like anyone else.
--
-- ── 1. the rename cooldown, on the table ─────────────────────────────────────────────────────
-- Ruled: once every 30 days; the old handle is free the moment it is released and old profile
-- links stop resolving — no history table, no redirect; the format is unchanged (the column's
-- regex CHECK and `profiles_handle_not_reserved`); and the cooldown lives in the database, not
-- only in the app.
--
-- A trigger rather than an RPC-only rule, for the reason #781's geo snap is one: `authenticated`
-- holds UPDATE on `profiles.handle` by name (20260617225450_m7_candidacy.sql; present on both
-- hosted projects on 2026-09-19, read from attacl with aclexplode), so a direct PostgREST UPDATE
-- is a write path the app does not own. A rule an RPC applied would be a
-- convention that path could ignore.
--
-- Four decisions, each asserted in pgTAP 0154:
--   * The FIRST choice starts no clock. A change from NULL — the value `handle_new_user` inserts
--     every profile with — neither checks nor stamps `handle_changed_at`, so a person who mistypes
--     at onboarding can fix it at once. The clock starts at the first RENAME.
--   * A write that names `handle` without changing it is not a rename. `UPDATE OF handle` fires
--     whenever the column is in the SET list, and the staging seed re-runs `set handle = p.handle`
--     over live personas; `is distinct from` lets both through untouched.
--   * A member cannot CLEAR their handle. `profileUpdateSchema` used to accept `handle: null`,
--     and without this refusal NULL-then-new would walk around the cooldown — or, the other way
--     round, trap the member on the onboarding handle step for thirty days. not_null_violation.
--   * The cooldown binds the member, not the operator. It is enforced only when the statement
--     runs as `authenticated` — the role PostgREST switches to for every signed-in request, and
--     the role pgTAP's member blocks run as. service_role and the postgres owner (support
--     renames, the staging seed, fixtures) pass, but still stamp the clock, so an operator rename
--     on a member's behalf counts as their rename. No SECURITY DEFINER function writes `handle`
--     today; one added later would run as its owner and pass too — that is a property to keep in
--     mind, not a hole: the member-facing path is the grant on the column, and that path is here.
--
-- The refusal is SQLSTATE PT429 with message `handle_cooldown`. PostgREST maps a PTxxx SQLSTATE
-- onto that HTTP status (the waitlist throttle's precedent, 20260809160525), so the app sees a 429
-- and the code alone tells it apart from 23505 (taken) and 23514 (malformed or reserved). The
-- message stays a machine token, never shown to a member (rule #5); DETAIL carries the instant the
-- next rename opens, ISO-8601 in UTC, which the app formats as «puoi cambiarlo di nuovo il …».
-- `@athanor/core`'s HANDLE_RENAME_COOLDOWN_DAYS is the same 30, and handle-cooldown.mirror.test.ts
-- reads the `interval` literals below against it — keep the refusing `if` on one line.
--
-- `now()` is the transaction's start. Both hosted projects run TimeZone = UTC with no per-role
-- override (pg_settings / pg_db_role_setting, 2026-09-19), and in UTC thirty days are always 720
-- hours — the elapsed time @athanor/core adds.
--
-- The trigger function is SECURITY INVOKER with an empty search_path, and loses EXECUTE for the
-- client roles at the end (0121's #409 rule for trigger functions in public).

alter table public.profiles add column handle_changed_at timestamptz;

comment on column public.profiles.handle_changed_at is
  'When the handle was last RENAMED (#782) — stamped by profiles_handle_cooldown on every change '
  'from one handle to another, never by the first choice (NULL until a first rename). A member '
  'may rename again from handle_changed_at + 30 days. No client grant: the owner reads it through '
  'get_own_profile(), nobody else reads it, and only the trigger writes it on a member''s path.';

comment on column public.profiles.handle is
  'The member''s @handle — chosen by them after sign-up (#782), never derived from their email. '
  'Format by CHECK (^[a-z0-9_]{3,30}$) and profiles_handle_not_reserved (#430); unique. NULL '
  'until the first choice; a member cannot clear it again. Renamed by the member at most once '
  'every 30 days (profiles_handle_cooldown); a released handle is free at once, and old /@handle '
  'links stop resolving — no history, no redirect.';

create function public.profiles_handle_cooldown()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.handle is not distinct from old.handle or old.handle is null then
    return new;
  end if;

  if current_user = 'authenticated' then
    if new.handle is null then
      raise exception 'handle_required' using errcode = 'not_null_violation';
    end if;
    if old.handle_changed_at is not null and now() < old.handle_changed_at + interval '30 days' then
      raise exception 'handle_cooldown'
        using errcode = 'PT429',
              detail = to_char(
                (old.handle_changed_at + interval '30 days') at time zone 'UTC',
                'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
              );
    end if;
  end if;

  new.handle_changed_at := now();
  return new;
end;
$$;

comment on function public.profiles_handle_cooldown() is
  'BEFORE UPDATE OF handle on profiles (#782). A change from NULL (the first choice) passes '
  'untouched; any other change stamps handle_changed_at. For a member (current_user = '
  'authenticated) it also refuses clearing the handle (23502) and a rename within 30 days of the '
  'last one (PT429 handle_cooldown, DETAIL = the ISO instant it opens). Operators pass.';

create trigger profiles_handle_cooldown
  before update of handle on public.profiles
  for each row
  execute function public.profiles_handle_cooldown();

-- #409: EXECUTE on a trigger function is checked when the TRIGGER is created, not when it fires,
-- so this does not reach any role's UPDATE of profiles.
revoke execute on function public.profiles_handle_cooldown() from public, anon, authenticated;

-- ── 2. anon reads the score, and only the score ──────────────────────────────────────────────
-- 20260617105734 granted SELECT on the whole table to anon beside the `aura_scores_select_anon`
-- policy (using true), so a signed-out caller could read every member's breakdown by kind of
-- action, their peak, the date of their last qualifying action and when the engine last ran —
-- the privacy policy said as much («compreso il dettaglio per tipo di azione, il massimo…»).
-- Ruled: the anon grant narrows to the score.
--
-- `profile_id` stays granted beside it: PostgREST can only filter on a column the role may
-- SELECT, and every read of one person's score is `?profile_id=eq.…` — a score-only grant would
-- answer nothing (the `events.deleted_at` precedent, 20260812054134).
--
-- Nothing signed-out reads more than that today. apps/web never names this table (the public
-- profile renders no score — packages/api/src/public-profile.ts), `getAuraScore` /
-- `getAuraScoreFull` in packages/api/src/aura.ts run only from the app behind a session, and
-- search_all lost its anon EXECUTE in 20260812111249. `authenticated` keeps the full row: a
-- member's own breakdown screen reads it, and rule 3 is about PUBLIC rendering. Rule 1 is
-- untouched — no client write path exists or appears here.
--
-- Realtime follows the grant: realtime.apply_rls filters each change's columns by
-- has_column_privilege for the subscriber, so the table staying in `supabase_realtime` re-opens
-- nothing to an anonymous subscriber. The existing policy is unchanged — it filters rows, and the
-- row set anon may see is still every row.
--
-- aura_scores thereby becomes the EIGHTH table with column-level ACLs: never `revoke all on
-- table` against it again (supabase-db.md), and 0121's count moves from 7 to 8.

revoke select on table public.aura_scores from anon;
grant select (profile_id, score) on table public.aura_scores to anon;

-- `comment on` replaces the WHOLE text: this is the 20260821164731 comment (confirmed against
-- obj_description on staging, 2026-09-19) with «World-readable» made true, and the #180 marker
-- 0128 looks for kept verbatim.
comment on table public.aura_scores is
  'Computed Aura snapshot (0–1000 + six breakdown buckets). Members read the whole row; anon reads profile_id and score only (#782); service-role write only (rule #1).

CONVENTION EXEMPTION (#180): no updated_at, no touch trigger — the row IS rewritten, on every score-engine run, but computed_at already records exactly that and names it honestly. This table has no created_at either: a snapshot has no birthday worth keeping, only a freshness. A generic updated_at beside computed_at would be a second name for one fact.';
