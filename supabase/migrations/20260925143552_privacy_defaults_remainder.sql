-- #790 — Privacy defaults, the remainder. Rulings by Marco on #790, 2026-09-25:
--
--   (1) The identity facet defaults to «Membri» for NEW members. Existing members keep what
--       they have; nothing is backfilled.
--   (2) The zodiac sign gets its own three-way visibility key, `zodiac`, defaulting to «Membri».
--   (3) RSVPs, including the «going» rows mirrored from paid tickets: the organiser and the
--       event's attendees see who is going; everyone else sees only the count.
--   (5) A visibility change that alters what the public page or its preview image shows purges
--       both from the web cache, through the purge path #800 built (handle-rename-purge +
--       _shared/kv-purge.ts). No second writer.
--
-- Ruling (4) — momento_terms does not mask the viewer's own «Solo io» fields when ranking for
-- them — needs nothing here: 20260817165404 already says so in its header and in the function
-- comment ("p_me is never masked (you always see yourself)").

-- ── 1. Identity facet: new members start at «Membri» ─────────────────────────────────────────
-- Only the column DEFAULT moves, so only rows created from now on are affected. handle_new_user
-- never names `visibility`, so every sign-up path (email, Google, Apple) takes this default.
--
-- The three places that read an ABSENT identity key as 'public' stay as they are on purpose:
-- the anon row policy (20260818123447), the avatar storage policy (20260818123711) and the
-- client chip (ProfileEditForm). 20260814151601 backfilled the key onto every row that existed
-- then, and a map the app writes carries every key it loaded, so an absent key belongs to an
-- older member or to a service-role write that replaced the whole map. Flipping that fallback
-- would silently take pages down for those members, which ruling (1) rules out.
alter table public.profiles
  alter column visibility set default '{"identity": "members"}'::jsonb;

-- ── 2. Zodiac: its own facet ─────────────────────────────────────────────────────────────────
-- `zodiac` is an ordinary visibility key. An absent key means «Membri», as it does for every
-- per-field key (athanor.field_visible, 20260807170813), so that is the default for everyone,
-- existing members included. Until now the sign was public for all of them (#694).
--
-- ANON. A column grant covers every row, and RLS picks rows, not columns, so the per-member
-- choice cannot ride the grant on zodiac_sign itself. anon therefore loses that column and gets
-- public_zodiac_sign instead: a second stored generated column that holds the sign only when
-- the member set zodiac to «Tutti», and NULL otherwise. There is no DEFINER function in the
-- read path (0080 forbids one anon can reach) and no view. It is recomputed on every write to
-- the row, in the same statement, so it can never disagree with the visibility map.
--
-- A generated column cannot reference another generated column, so it derives from birth_date
-- directly, through the same one-home function. EXECUTE on athanor.zodiac_sign is already held
-- by every writing role: authenticated (20260905165133) and service_role (20260905171924).
alter table public.profiles
  add column public_zodiac_sign text
    generated always as (
      case when visibility ->> 'zodiac' = 'public' then athanor.zodiac_sign(birth_date) end
    ) stored;

comment on column public.profiles.public_zodiac_sign is
  'zodiac_sign when the member set visibility.zodiac = ''public'' («Tutti»), else NULL (#790). '
  'GENERATED, never client-written. The anon read of the sign: anon holds SELECT on this column '
  'and not on zodiac_sign, because a column grant cannot follow a per-row choice.';

comment on column public.profiles.zodiac_sign is
  'Sun sign, GENERATED from birth_date via athanor.zodiac_sign — never written by a client. '
  'Visibility key `zodiac` (#790; absent = members). No direct client SELECT: members read it '
  'through get_own_profile / get_person_profile (field_visible-gated), anon reads '
  'public_zodiac_sign. Not granted to authenticated for the PG17 publication reason in '
  '20260905165133.';

-- profiles carries column-level ACLs: name the column, never `revoke all on table`.
revoke select (zodiac_sign) on table public.profiles from anon;
grant select (public_zodiac_sign) on table public.profiles to anon;
-- Nothing to authenticated: its SELECT set must equal the realtime publication's column list
-- (0073), and PG17 refuses a generated column in that list (20260905165133 header).

-- get_person_profile: the sign now obeys its key, and the projection gains has_public_page.
-- drop + create, not `create or replace`: the OUT list changes and Postgres refuses that in
-- place (42P13). Dropping discards the ACL, so the revoke/grant pair is re-issued below (0080
-- sweeps it). Body is 20260905165133's with the zodiac arm changed and one column added.
--
-- has_public_page exists because of ruling (1). The share sheet puts the /@handle link in the
-- message, and with «Membri» as the default that link is a 404 for every new member — the
-- state #251 fixed by making the page the default. The sheet now carries the link only when
-- the page exists. Same predicate as the anon row policy (20260818123447), so it cannot say
-- yes to a page anon cannot load. It tells a member no more than opening the link would.
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
  removed boolean,
  has_public_page boolean
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
    -- #790: its own key now, absent = members, like every field above
    case when p.banned_at is null and athanor.field_visible(p.id, 'zodiac')        then p.zodiac_sign end,
    -- a tombstone wears no badges
    p.banned_at is null and p.founding_member,
    p.banned_at is null and p.identity_verified,
    p.banned_at is not null,
    -- the anon row policy's predicate, verbatim (#790)
    p.banned_at is null and coalesce(p.visibility ->> 'identity', 'public') = 'public'
  from public.profiles p
  where p.id = p_profile_id
    and (select auth.uid()) is not null
    and athanor.not_blocked(p.id);
$$;

comment on function public.get_person_profile(uuid) is
  'Third-person profile projection. bio/mission/identity_tags/seeking/skills/profession/city/'
  'zodiac_sign arrive NULL when the owner hid them (M10 visibility, absent key = members; '
  'zodiac has its own key since #790); display_name and avatar_path are identity surface and '
  'never masked for a visible member (#76); birth_date and city_geohash are never projected '
  'here at all (#694, #149). Signed-in callers only, blocked pairs excluded both ways. A BANNED '
  'member still resolves, as a tombstone: every identity and content column NULL, both badges '
  'false, removed = true (#314) — so a surviving reply in someone else''s thread can be '
  'attributed to «account removed» rather than to the generic missing-profile placeholder. '
  'has_public_page (#790) mirrors the anon row policy: true exactly when /@handle resolves '
  'for a signed-out reader, so the share sheet carries the link only then.';

revoke execute on function public.get_person_profile(uuid) from public, anon;
grant execute on function public.get_person_profile(uuid) to authenticated;

-- ── 3. RSVPs: names for the organiser and the attendees, a count for everyone else ───────────
-- Ticket-derived «going» rows live in this same table (stripe-webhook mirrorRsvp, #522), so
-- one policy covers both paths.
--
-- The attendee half of the predicate asks "does the caller hold a going row on this event?",
-- which is a read of rsvps from inside an rsvps policy. Inlined, that recurses (42P17). A
-- DEFINER helper reads the table as its owner and the recursion does not happen. The athanor
-- schema has no anon USAGE, and EXECUTE goes to authenticated only; the policy is TO
-- authenticated.
create function athanor.sees_event_attendees(p_event_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
           select 1 from public.events e
            where e.id = p_event_id
              and e.organizer_id = (select auth.uid())
         )
      or exists (
           select 1 from public.rsvps r
            where r.event_id = p_event_id
              and r.user_id = (select auth.uid())
              and r.status = 'going'
         );
$$;

comment on function athanor.sees_event_attendees(uuid) is
  'True when the caller organises the event or holds a going RSVP on it (#790) — the two roles '
  'allowed to see who else is going. DEFINER only so the rsvps SELECT policy can ask about '
  'rsvps without recursing (42P17). Authenticated only.';

revoke execute on function athanor.sees_event_attendees(uuid) from public, anon;
grant execute on function athanor.sees_event_attendees(uuid) to authenticated;

-- Renamed as well as narrowed: a policy called «select_authenticated» that no longer lets every
-- authenticated member read would mislead the next reader. 0022 lists policies by name.
drop policy "rsvps_select_authenticated" on public.rsvps;
-- Other members' rows only while they say 'going': the ruling lets these two roles see who is
-- going, not who changed their mind. A member's own row, cancelled or not, stays theirs to read.
create policy "rsvps_select_own_or_attendee"
  on public.rsvps for select
  to authenticated
  using (
    user_id = (select auth.uid())
    or (status = 'going' and athanor.sees_event_attendees(event_id))
  );

-- The count, for everyone signed in. Counting rows as the client stops working the moment the
-- policy above narrows them: a non-attendee would read 0 and a full free event would look open.
-- DEFINER, returns a number and never a row — the shape of event_seats_taken (20260812225214).
-- The deleted_at filter mirrors events_select_authenticated, so a deleted event has no count.
create function public.event_going_count(p_event_id uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::int
    from public.rsvps r
   where r.event_id = p_event_id
     and r.status = 'going'
     and (select auth.uid()) is not null
     and exists (
           select 1 from public.events e
            where e.id = p_event_id
              and e.deleted_at is null
         );
$$;

comment on function public.event_going_count(uuid) is
  'Going head-count for an event (#790). DEFINER because rsvps SELECT is limited to the '
  'caller''s own row plus the organiser and the attendees; returns a count, never rows. '
  'Signed-in callers only; a deleted event counts 0.';

revoke execute on function public.event_going_count(uuid) from public, anon;
grant execute on function public.event_going_count(uuid) to authenticated;

-- ── 4. Purge the public page and its preview image when visibility changes ───────────────────
-- /@handle and /@handle/opengraph-image sit in the OpenNext KV cache. The page refreshes on its
-- 5-minute ISR clock, but the image is force-static and would otherwise change only at the next
-- deploy. The #800 trigger fires only on a handle rename, so a switch to «Membri» left the
-- member's name, photo and dream quote on the card until release.
--
-- Same function, same Vault pair, same edge function: athanor.enqueue_handle_rename_purge posts
-- `old.handle`, and the WHEN clause below only lets through updates where the handle did NOT
-- change, so old.handle is the live handle. An update that changes the handle AND the
-- visibility is the rename trigger's; the page under the new handle has never been rendered.
--
-- The WHEN clause is the cost gate. The edit form sends the whole visibility map on every save,
-- and each purge lists the whole cache namespace, so the trigger fires only when one of the
-- three facets the page or its image depends on changes what ANON sees: identity (whether the
-- page exists), dream (the quote on the card and the page), zodiac (the sign on the page). Each
-- is reduced to "is it «Tutti»?" after its own absent-key fallback, because anon sees a facet
-- only when it is 'public': a move between «Membri» and «Solo io», or an explicit key equal to
-- its fallback, changes nothing on the page and posts nothing.
create trigger profiles_visibility_purge
  after update of visibility on public.profiles
  for each row
  when (
    old.handle is not null
    and new.handle is not distinct from old.handle
    and (
         (coalesce(old.visibility ->> 'identity', 'public')  = 'public') <> (coalesce(new.visibility ->> 'identity', 'public')  = 'public')
      or (coalesce(old.visibility ->> 'dream',    'members') = 'public') <> (coalesce(new.visibility ->> 'dream',    'members') = 'public')
      or (coalesce(old.visibility ->> 'zodiac',   'members') = 'public') <> (coalesce(new.visibility ->> 'zodiac',   'members') = 'public')
    )
  )
  execute function athanor.enqueue_handle_rename_purge();

comment on function athanor.enqueue_handle_rename_purge() is
  'Posts a handle to the handle-rename-purge edge function, which drops /@handle and its OG '
  'card from the web cache. Two triggers on profiles call it: AFTER UPDATE OF handle (#800, '
  'the handle a member renamed away from) and AFTER UPDATE OF visibility (#790, the live handle '
  'when the identity, dream or zodiac facet changes). No-op until '
  'app.settings.handle_rename_purge_url/_key exist in Vault; fail-open.';
