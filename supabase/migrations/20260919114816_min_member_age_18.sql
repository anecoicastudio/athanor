-- #778 — the minimum member age becomes 18 for the first release (ruled 2026-09-19).
--
-- Reverses, for launch, #694's floor of 14 (the GDPR Art. 8 digital-consent age as Italy set it,
-- 20260905165133). Membership is adults only; no parental-consent path exists. The number has
-- three homes that must agree: @athanor/core's MIN_MEMBER_AGE (the funnel's early, well-messaged
-- refusal), this guard (defence in depth: 23514 at the flush), and pgTAP 0146 (the exact
-- boundary). packages/core/src/onboarding/min-age.mirror.test.ts reads the LAST migration that
-- defines this function and pins its `interval 'N years'` against MIN_MEMBER_AGE — keep the `if`
-- line's shape, or that test cannot find the number.
--
-- `create or replace`, not drop + create: the signature is unchanged, so the trigger keeps
-- pointing at the same function and the function keeps its owner and ACL (the #409 revoke of
-- 20260905165133). The revoke is re-issued anyway — it is idempotent, and 0146's two
-- has_function_privilege assertions are the only witness for a trigger function in the athanor
-- schema (0121 filters nspname = public; MIGRATIONS-ERRATA 20260905165133).
--
-- The trigger is untouched: BEFORE INSERT OR UPDATE OF birth_date, WHEN the new date is not null.
-- A row already under 18 is therefore NOT locked out of other profile edits — only a write of
-- birth_date itself is measured. Hosted counts on 2026-09-19, read-only: staging 0 of 19 profiles
-- under 18, production 0 of 3. No row is changed here.
--
-- Leap day, same rule as before: `v_today - interval '18 years'` on 2026-02-28 yields 2008-02-28,
-- so a member born 2008-02-29 is admitted from 1 March 2026 — the reading @athanor/core's
-- isAtLeastAge applies (turns N on 1 March in a non-leap year).
--
-- `comment on` replaces the WHOLE text, so both comments below are the 20260905165133 texts
-- (confirmed against obj_description / col_description on staging) with the number changed and
-- #778 cited — nothing else dropped.

create or replace function athanor.profiles_birth_date_guard()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_today date := (now() at time zone 'utc')::date;
begin
  if new.birth_date > (v_today - interval '18 years')::date then
    raise exception 'minimum age is 18' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

comment on function athanor.profiles_birth_date_guard() is
  'BEFORE INSERT/UPDATE OF birth_date on profiles (#694, #778): refuses a date younger than 18 '
  'years at UTC today with 23514. Defence in depth behind the funnel''s Zod + core refusal.';

revoke execute on function athanor.profiles_birth_date_guard() from public, anon, authenticated;

comment on column public.profiles.birth_date is
  'Date of birth (#694). OWNER-ONLY: no client SELECT grant on this column — the only read '
  'path is get_own_profile(); never projected to another member or to anon. Owner UPDATE/'
  'INSERT granted per column. Min age 18 (#778) is enforced by '
  'athanor.profiles_birth_date_guard (trigger), the 1900 floor by CHECK. Nullable: pre-#694 '
  'members and the pre-flush row.';
