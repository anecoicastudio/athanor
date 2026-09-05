-- #694 — profiles gain a birth date (owner-only) and a derived, public zodiac sign.
--
-- The product ask: a zodiac glyph beside the display name in the profile header, derived from
-- the member's date of birth, collected as a required onboarding step for new sign-ups (min age
-- 14 — GDPR Art. 8, the Italian floor). Decisions settled with Marco 2026-09-05:
--   • birth_date   — PRIVATE. Owner UPDATE/INSERT only; NO client SELECT grant on the column, so
--                    the only read path is get_own_profile() (DEFINER `select *`, 20260807170813).
--                    Never projected to another member, never to anon.
--   • zodiac_sign  — PUBLIC, always on, no visibility key. A STORED GENERATED column, so it is
--                    never client-written and cannot disagree with the date.
--
-- ONE HOME FOR THE CUSP TABLE: athanor.zodiac_sign(date). The Italian fixed convention
-- (Ariete 21/03–20/04 … Pesci 20/02–20/03; Capricorno wraps the year). @athanor/core carries
-- the same table for the funnel's live «Sei Leone» reveal; its zodiac.test pins the 24 boundary
-- days, 0146 pins the same 24 against this function, and the schemas mirror test pins the
-- twelve keys below against ZODIAC_SIGNS — three tests, one truth.
--
-- WHY zodiac_sign IS GRANTED TO anon BUT NOT TO authenticated. Postgres 17 refuses a stored
-- generated column in a publication column list ("cannot use generated column in publication
-- column list"; relaxed only in PG18), and 0073 asserts that the profiles realtime publication
-- column list EQUALS the authenticated SELECT column-grant set. Granting the column to
-- authenticated would therefore make 0073 unsatisfiable. Members read the sign through the two
-- DEFINER RPCs instead — get_own_profile (select *, nothing to do) and get_person_profile
-- (widened below). anon needs the direct grant because apps/web's /@handle page reads the shell
-- columns straight off the table (20260814151601). Do NOT "fix" this asymmetry by widening the
-- authenticated grant; 0146 asserts it in both directions.
--
-- MIN AGE: a BEFORE trigger, not a CHECK. Postgres would accept `current_date` inside a CHECK,
-- but the repo has no precedent for a volatile CHECK and two for guard triggers raising
-- check_violation (20260616042201 momento status, 20260614131843 milestone helps). The trigger
-- is defence in depth; the early, well-messaged refusal is Zod + @athanor/core in the funnel.
-- An immutable floor CHECK (1900-01-01) catches the picker's «year 1» kind of garbage.

-- ── 1. Derivation ───────────────────────────────────────────────────────────────────────
-- IMMUTABLE (a generated column demands it), STRICT (NULL date → NULL sign without entering
-- the body), athanor-scoped like field_visible (20260807170813): anon holds no USAGE on the
-- schema and no EXECUTE here. authenticated needs EXECUTE because a generation expression is
-- evaluated as the WRITING role — the owner's onboarding UPDATE — and Postgres checks the
-- function privilege at that point. service_role keeps the default-ACL 'f' row.
create function athanor.zodiac_sign(p_birth_date date)
returns text
language sql
immutable
strict
parallel safe
set search_path = ''
as $$
  select case
    when md between  321 and  420 then 'ariete'
    when md between  421 and  520 then 'toro'
    when md between  521 and  621 then 'gemelli'
    when md between  622 and  722 then 'cancro'
    when md between  723 and  823 then 'leone'
    when md between  824 and  922 then 'vergine'
    when md between  923 and 1022 then 'bilancia'
    when md between 1023 and 1122 then 'scorpione'
    when md between 1123 and 1221 then 'sagittario'
    when md >= 1222 or md <= 120  then 'capricorno'
    when md between  121 and  219 then 'acquario'
    else 'pesci'                                   -- 220 … 320
  end
  from (
    select extract(month from p_birth_date)::int * 100
         + extract(day   from p_birth_date)::int as md
  ) x
$$;

comment on function athanor.zodiac_sign(date) is
  'Sun sign for a birth date, Italian fixed-cusp convention (#694): ariete 21/03–20/04, toro '
  '21/04–20/05, gemelli 21/05–21/06, cancro 22/06–22/07, leone 23/07–23/08, vergine 24/08–22/09, '
  'bilancia 23/09–22/10, scorpione 23/10–22/11, sagittario 23/11–21/12, capricorno 22/12–20/01, '
  'acquario 21/01–19/02, pesci 20/02–20/03. The one home for the table; @athanor/core mirrors it.';

revoke execute on function athanor.zodiac_sign(date) from public, anon;
grant execute on function athanor.zodiac_sign(date) to authenticated;

-- ── 2. Columns ──────────────────────────────────────────────────────────────────────────
-- birth_date is nullable: the profile row is created by handle_new_user at auth INSERT, before
-- the funnel's answers are flushed, and every member who signed up before this migration has
-- none. isProfileComplete (@athanor/core) deliberately does NOT require it — it would route
-- every existing member back into the funnel. Requiredness lives in onboardingAnswersSchema,
-- i.e. new sign-ups only.
alter table public.profiles
  add column birth_date date
    constraint profiles_birth_date_floor check (birth_date is null or birth_date >= date '1900-01-01'),
  add column zodiac_sign text
    generated always as (athanor.zodiac_sign(birth_date)) stored;

-- The list below is load-bearing text: packages/schemas/src/zodiac.mirror.test.ts reads the
-- LAST `add constraint profiles_zodiac_sign_check check (` … `\n  );` in migration order and
-- pins the quoted keys, in order, against ZODIAC_SIGNS. Widen or reorder here and the test
-- says so.
alter table public.profiles
  add constraint profiles_zodiac_sign_check check (
    zodiac_sign is null or zodiac_sign in (
      'ariete', 'toro', 'gemelli', 'cancro', 'leone', 'vergine',
      'bilancia', 'scorpione', 'sagittario', 'capricorno', 'acquario', 'pesci'
    )
  );

comment on column public.profiles.birth_date is
  'Date of birth (#694). OWNER-ONLY: no client SELECT grant on this column — the only read '
  'path is get_own_profile(); never projected to another member or to anon. Owner UPDATE/'
  'INSERT granted per column. Min age 14 is enforced by athanor.profiles_birth_date_guard '
  '(trigger), the 1900 floor by CHECK. Nullable: pre-#694 members and the pre-flush row.';
comment on column public.profiles.zodiac_sign is
  'Sun sign, GENERATED from birth_date via athanor.zodiac_sign — never written by a client. '
  'PUBLIC: SELECT granted to anon (apps/web /@handle). Deliberately NOT granted to '
  'authenticated: PG17 cannot carry a generated column in the realtime publication column '
  'list and 0073 pins publication == authenticated grant, so members read it through '
  'get_own_profile / get_person_profile instead (#694).';

-- ── 3. Min-age guard ────────────────────────────────────────────────────────────────────
-- Fires only when a non-null date is being written (WHEN clause), so clearing the date and
-- every unrelated profile UPDATE skip it. UTC calendar day, the proposed_on precedent.
-- Leap-day note: `v_today - interval '14 years'` on 2026-02-28 yields 2012-02-28, so a member
-- born 2012-02-29 is admitted from 1 March 2026 — the same rule @athanor/core's isAtLeastAge
-- applies (turns N on 1 March in a non-leap year). 0146 asserts the exact boundary.
create function athanor.profiles_birth_date_guard()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_today date := (now() at time zone 'utc')::date;
begin
  if new.birth_date > (v_today - interval '14 years')::date then
    raise exception 'minimum age is 14' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

comment on function athanor.profiles_birth_date_guard() is
  'BEFORE INSERT/UPDATE OF birth_date on profiles (#694): refuses a date younger than 14 years '
  'at UTC today with 23514. Defence in depth behind the funnel''s Zod + core refusal.';

-- A trigger function is born EXECUTE-able by PUBLIC and both client roles (#409 — the default
-- ACL was never narrowed for functions); 0121 demands the revoke.
revoke execute on function athanor.profiles_birth_date_guard() from public, anon, authenticated;

create trigger profiles_birth_date_guard
  before insert or update of birth_date on public.profiles
  for each row
  when (new.birth_date is not null)
  execute function athanor.profiles_birth_date_guard();

-- ── 4. Grants — named verbs only ────────────────────────────────────────────────────────
-- profiles carries column-level ACLs (0121 pins the count); NEVER `revoke all on table` here.
-- Table-level INSERT/UPDATE were revoked in 20260617225450 and re-granted per column; every
-- column added since must extend the lists or it is silently unwritable by its owner
-- (20260814104755 precedent). zodiac_sign gets no write grant: generated columns cannot be
-- written, and a grant would only invite a 42601 at the wrong layer.
grant update (birth_date) on table public.profiles to authenticated;
grant insert (birth_date) on table public.profiles to authenticated;
grant select (zodiac_sign) on table public.profiles to anon;
-- No SELECT on birth_date for anyone. No SELECT on zodiac_sign for authenticated (header).
-- No publication change: the authenticated grant set is unchanged, so 0073 stays exact.

-- ── 5. get_person_profile — widen the third-person projection ───────────────────────────
-- drop + create, not `create or replace`: the OUT list changes and Postgres refuses that in
-- place (42P13). Dropping discards the ACL, so the revoke/grant pair is re-issued below —
-- 0080's sweep fails otherwise (the 20260814104755 / 20260818114947 precedent). Body is
-- 20260818114947's plus zodiac_sign, which is public (no field_visible gate) but still a
-- tombstone-nulled column: a removed account shows no sign. birth_date is never projected.
drop function if exists public.get_person_profile(uuid);

create function public.get_person_profile(p_profile_id uuid)
returns table (
  id uuid,
  handle text,
  display_name text,
  avatar_path text,
  bio text,
  mission text,
  identity_tags text[],
  seeking text[],
  skills text[],
  profession text,
  city text,
  zodiac_sign text,
  founding_member boolean,
  identity_verified boolean,
  removed boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    p.id,
    case when p.banned_at is null then p.handle end,
    case when p.banned_at is null then p.display_name end,
    case when p.banned_at is null then p.avatar_path end,
    case when p.banned_at is null and athanor.field_visible(p.id, 'bio')           then p.bio end,
    case when p.banned_at is null and athanor.field_visible(p.id, 'mission')       then p.mission end,
    case when p.banned_at is null and athanor.field_visible(p.id, 'identity_tags') then p.identity_tags end,
    case when p.banned_at is null and athanor.field_visible(p.id, 'seeking')       then p.seeking end,
    case when p.banned_at is null and athanor.field_visible(p.id, 'skills')        then p.skills end,
    case when p.banned_at is null and athanor.field_visible(p.id, 'profession')    then p.profession end,
    case when p.banned_at is null and athanor.field_visible(p.id, 'city')          then p.city end,
    -- public by decision (#694): no visibility key, only the tombstone masks it
    case when p.banned_at is null then p.zodiac_sign end,
    -- a tombstone wears no badges
    p.banned_at is null and p.founding_member,
    p.banned_at is null and p.identity_verified,
    p.banned_at is not null
  from public.profiles p
  where p.id = p_profile_id
    and (select auth.uid()) is not null
    and athanor.not_blocked(p.id);
$$;

comment on function public.get_person_profile(uuid) is
  'Third-person profile projection. bio/mission/identity_tags/seeking/skills/profession/city '
  'arrive NULL when the owner hid them (M10 visibility, absent key = members); display_name '
  'and avatar_path are identity surface and never masked for a visible member (#76); '
  'zodiac_sign is public and unmasked (#694) — birth_date is never projected here at all; '
  'city_geohash is never projected here at all (#149). Signed-in callers only, blocked pairs '
  'excluded both ways. A BANNED member still resolves, as a tombstone: every identity and '
  'content column NULL, both badges false, removed = true (#314) — so a surviving reply in '
  'someone else''s thread can be attributed to «account removed» rather than to the generic '
  'missing-profile placeholder.';

revoke execute on function public.get_person_profile(uuid) from public, anon;
grant execute on function public.get_person_profile(uuid) to authenticated;
