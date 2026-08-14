-- #149 — profiles gain mission, skills, profession and an approximate city.
--
-- PRD §4.2 has specified «Bio, mission, skills (tags), city (approximate)» since M1; the
-- columns never landed and three features wait on them (#123 matcher signal, #151 event
-- filters, #243/#225 fund surfaces). This migration is the data layer plus the visibility
-- plumbing; the matcher/search consumers are deliberately NOT wired here (#123 owns them).
--
-- Shapes (settled with Marco 2026-08-14):
--   • mission        — free text, the member's own words, like bio. No vocabulary.
--   • skills         — text[] of CURATED keys (@athanor/core SKILLS, labels tag.skill.*).
--                      Free-text skills would kill the future matcher term the way the
--                      disjoint vocabularies killed two affinity terms before #273.
--   • profession     — single curated key (@athanor/core PROFESSIONS, labels tag.profession.*).
--   • city           — display name from the city search picker (or free text fallback).
--   • city_geohash   — precision-5 geohash (≈ 4.9 km cell) computed client-side from the
--                      PICKED suggestion's coordinates; free-text city stores NO geohash, so
--                      the future proximity term simply skips that member. Never device
--                      geolocation — the picker is typed-text search only.
--
-- VISIBILITY TIER. All four member-facing fields are profile CONTENT — what the member
-- wrote about themselves — so they join the M10 gated tier alongside bio/identity_tags/
-- seeking (20260807170813), each under its own visibility key ('mission', 'skills',
-- 'profession', 'city'), absent key = 'members'. They are NOT added to the direct
-- authenticated SELECT grant, and NOT added to the realtime publication column list
-- (0073 asserts publication == grant, so the two stay equal by both excluding them).
-- city_geohash is gated with 'city' but never projected third-person at all: no client
-- renders another member's geohash — it exists for the server-side proximity term — and
-- withholding it keeps the cell coordinates out of every projection a client can reach.
--
-- Vocabulary membership is enforced app-side (@athanor/core), not by CHECK — same
-- decision as identity_tags/seeking (20260612205727 caps cardinality only), so a
-- vocabulary edit stays a TypeScript change, not a migration.

-- ── 1. Columns ──────────────────────────────────────────────────────────────────────────
-- All nullable (#149): a profile that says nothing is a first-class state. skills defaults
-- to '{}' so array ops never meet NULL in practice. Caps follow the house pattern: mission
-- mirrors bio's 500, skills mirrors the tag arrays' 10 (20260612205727), city takes a
-- display-name-grade cap, city_geohash pins the exact precision-5 base32 shape (the
-- alphabet excludes a, i, l, o).
alter table public.profiles
  add column mission text
    check (mission is null or char_length(mission) <= 500),
  add column skills text[] default '{}'
    check (coalesce(array_length(skills, 1), 0) <= 10),
  add column profession text
    check (profession is null or char_length(profession) <= 40),
  add column city text
    check (city is null or char_length(city) <= 80),
  add column city_geohash text
    check (city_geohash is null or city_geohash ~ '^[0-9b-hjkmnp-z]{5}$');

comment on column public.profiles.mission is
  '«La mia missione» — free text in the member''s own words, like bio (PRD §4.2). Visibility key ''mission''.';
comment on column public.profiles.skills is
  'Curated keys from @athanor/core SKILLS (labels tag.skill.*). Cardinality-capped like identity_tags; membership enforced app-side. Visibility key ''skills''.';
comment on column public.profiles.profession is
  'Single curated key from @athanor/core PROFESSIONS (labels tag.profession.*). Visibility key ''profession''.';
comment on column public.profiles.city is
  'Display name: picked from the city search or typed free text (PRD §4.2 «city (approximate)»). Visibility key ''city''.';
comment on column public.profiles.city_geohash is
  'Precision-5 geohash of the PICKED city''s coordinates (≈ 4.9 km cell) — NULL when city was typed free text. Never device geolocation. Gated with ''city'' but never projected third-person; it exists for the server-side proximity term (#123).';

-- ── 2. Write grants ─────────────────────────────────────────────────────────────────────
-- Table-level INSERT/UPDATE were revoked in 20260617225450 and re-granted per column;
-- every column added since must extend the lists or it is silently unwritable by its
-- owner (the 20260811072211 precedent).
grant update (mission, skills, profession, city, city_geohash) on table public.profiles to authenticated;
grant insert (mission, skills, profession, city, city_geohash) on table public.profiles to authenticated;

-- ── 3. get_person_profile — widen the third-person projection ───────────────────────────
-- drop + create, not `create or replace`: Postgres refuses to change an OUT-parameter
-- list in place (42P13), and dropping discards the ACL, so the revoke/grant pair is
-- re-issued below (0080's sweep fails otherwise). Body is 20260812111249's plus the four
-- new gated fields; city_geohash is deliberately absent (header).
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
  founding_member boolean,
  identity_verified boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    p.id,
    p.handle,
    p.display_name,
    p.avatar_path,
    case when athanor.field_visible(p.id, 'bio') then p.bio end,
    case when athanor.field_visible(p.id, 'mission') then p.mission end,
    case when athanor.field_visible(p.id, 'identity_tags') then p.identity_tags end,
    case when athanor.field_visible(p.id, 'seeking') then p.seeking end,
    case when athanor.field_visible(p.id, 'skills') then p.skills end,
    case when athanor.field_visible(p.id, 'profession') then p.profession end,
    case when athanor.field_visible(p.id, 'city') then p.city end,
    p.founding_member,
    p.identity_verified
  from public.profiles p
  where p.id = p_profile_id
    and (select auth.uid()) is not null
    and athanor.not_blocked(p.id);
$$;

comment on function public.get_person_profile(uuid) is
  'Third-person profile projection. bio/mission/identity_tags/seeking/skills/profession/city '
  'arrive NULL when the owner hid them (M10 visibility, absent key = members); display_name '
  'and avatar_path are identity surface and never masked (#76); city_geohash is never '
  'projected here at all (#149). Signed-in callers only, blocked pairs excluded both ways.';

revoke execute on function public.get_person_profile(uuid) from public, anon;
grant execute on function public.get_person_profile(uuid) to authenticated;

-- NOT widened here, deliberately: athanor.profile_search_text / search_all (skills or city
-- as search terms are a product decision that belongs with the consumers, #151/#123) and
-- run_momenti_matcher (the affinity signals are #123's whole scope). get_own_profile is
-- `select *` and needs nothing.
