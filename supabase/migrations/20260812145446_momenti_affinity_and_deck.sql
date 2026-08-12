-- #273 — Momenti ranking: revive the two dead affinity terms, stop the deck from
-- serving a stale backlog, and compute the match reasons at READ time.
--
-- What was wrong (all verified against staging on 2026-08-12):
--
--   A. `packages/core/src/onboarding/tags.ts` defines two DISJOINT vocabularies
--      (identity: imprenditore/freelance/coach/artista/creativo/mentor/investitore;
--      seeking: connessioni/collaborazioni/crescita/eventi/business/mentorship) and
--      `onboarding/validate.ts` restricts writes to them. So in the previous matcher
--      body (20260807174758 L88-113) `seek_hit = my seeking ∩ their identity_tags`
--      and `offer_hit = my identity_tags ∩ their seeking` could only ever be {}.
--      Affinity collapsed to "same identity label"; complementarity — mentor ↔
--      mentorship, investitore ↔ business, freelance ↔ collaborazioni, the whole
--      reason the two terms exist — was never scored. Staging: 81 proposals, avg
--      affinity 1.17, max 2. athanor.seeking_to_identity() below is the missing
--      translation, mirroring packages/core/src/onboarding/affinity.ts (which is the
--      source of truth; affinity.mirror.test.ts asserts the two agree).
--
--   B. Pending proposals never expired, and the ≤3/day cap counts only TODAY's rows,
--      so the matcher kept adding 3/night on top of an unswiped backlog while
--      `getMomentiDeck` ordered by `daily_rank` alone — a rank that restarts at 1
--      every day. A member who did not swipe saw an arbitrary trio drawn from every
--      `daily_rank = 1` row ever written. Staging: top users held 7 pending across 3
--      days. Each pending row also blocks its pair forever through
--      momento_proposals_user_candidate_uniq, so the candidate pool drained.
--      Fixed by expire_momento_proposals() (DELETE, not auto-pass: the pair must go
--      back in the pool without burning the 90-day suppression window) plus the
--      (proposed_on desc, daily_rank asc) order in get_momenti_deck().
--
--   C. `where affinity > 0` shipped a Momento on ONE shared tag out of seven. The
--      threshold is now MOMENTO_AFFINITY_THRESHOLD = 2, which is only reachable
--      because A revived the other two terms.
--
--   D. momento_reasons() (20260616044148 L10-39) localized the PREFIX and spliced
--      raw Italian tag keys into both locales («You share: artista, creativo»), and
--      froze the string at insert — which is the sole reason the purge apparatus
--      (20260807201350, 20260807203343, trigger profiles_purge_momenti) exists: to
--      delete rows whose stored prose went stale. get_momenti_deck() now returns the
--      TERMS, recomputed and re-masked on every read, and the client renders them
--      from tag.identity.* + momenti.reason.*. Reasons are therefore always fresh,
--      always masked and always localized, and the purge apparatus is retired at the
--      bottom of this file rather than kept treating the symptom.
--
--   E. A member holding a rare tag scored 0 against everyone and got NOTHING —
--      forever, and worst exactly at launch when the community is sparsest. The
--      matcher now falls back to a dream-recency proposal (affinity 0), which
--      get_momenti_deck() labels `new_dream` so the card can say «Sogno nuovo»
--      rather than claim an affinity it does not have. Same honesty precedent as
--      get_momenti_suggestion (20260808041335, now 20260812111249 L79-108).
--
--   F. The matcher is an unbounded profiles × profiles cross join with array
--      intersects per pair. Ceiling recorded, NOT fixed here — see the note above
--      run_momenti_matcher() and docs/PRODUCTION-READINESS.md.
--
-- Unchanged on purpose:
--   · `affinity` stays server-only. get_momenti_deck() is DEFINER and returns a
--     reason KIND, never the number (rule #1, and the column-level SELECT grant).
--   · The matcher stays SECURITY DEFINER, cron-only, execute revoked from
--     anon/authenticated. The 03:11 UTC schedule is reused, not re-created.
--   · The matcher keeps the RAW jsonb visibility check rather than
--     athanor.field_visible: it runs as cron with no auth.uid(), where field_visible
--     falls to its anon branch and would exclude every members-default profile
--     (20260807174758 L8-12). get_momenti_deck(), which DOES have a caller, uses
--     field_visible.

-- ── 1. Tag helpers (athanor: not client-callable, and not part of any API) ───

-- Sorted, deduplicated set intersection. Sorted because the deck renders these and a
-- stable order is what makes two reads comparable.
create function athanor.tag_intersect(a text[], b text[])
returns text[]
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    array(select distinct x
            from unnest(coalesce(a, '{}'::text[])) x
           where x = any (coalesce(b, '{}'::text[]))
           order by x),
    '{}'::text[]);
$$;

comment on function athanor.tag_intersect(text[], text[]) is
  'Sorted, deduplicated intersection of two tag arrays. NULL-safe on both sides: a '
  'visibility-masked field arrives as {} and must score nothing, never match everything.';

-- The seeking → identity map (#273 A). MIRRORS packages/core/src/onboarding/affinity.ts
-- — edit both or the mirror test fails.
--   · connessioni and eventi are deliberately ABSENT: they name no profession, so no
--     identity complements them. Mapping them to the whole vocabulary would score
--     every pair, which is the same noise the `affinity > 0` threshold produced.
create function athanor.seeking_to_identity(p_seeking text[])
returns text[]
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    array(select distinct m.identity
            from unnest(coalesce(p_seeking, '{}'::text[])) s(tag)
            join (values
              ('collaborazioni', 'artista'),
              ('collaborazioni', 'creativo'),
              ('collaborazioni', 'freelance'),
              ('crescita', 'coach'),
              ('crescita', 'mentor'),
              ('business', 'imprenditore'),
              ('business', 'investitore'),
              ('mentorship', 'coach'),
              ('mentorship', 'mentor')
            ) as m(seeking, identity) on m.seeking = s.tag
           order by 1),
    '{}'::text[]);
$$;

comment on function athanor.seeking_to_identity(text[]) is
  'What a member SEEKS, expressed as the identity tags that answer it (#273 A). The '
  'two onboarding vocabularies are disjoint, so intersecting seeking with '
  'identity_tags directly can only return {}. Mirrors packages/core/src/onboarding/'
  'affinity.ts — affinity.mirror.test.ts asserts the two copies agree.';

-- Mutual-block check for a pair, with NEITHER side being the caller: the matcher runs
-- as cron with no auth.uid(), so athanor.not_blocked (which reads auth.uid()) cannot
-- answer for it. Same predicate, both directions, two explicit arguments.
create function athanor.pair_not_blocked(a uuid, b uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select not exists (
    select 1 from public.blocks bl
     where (bl.blocker_id = a and bl.blocked_id = b)
        or (bl.blocker_id = b and bl.blocked_id = a)
  );
$$;

revoke execute on function athanor.tag_intersect(text[], text[]) from public, anon, authenticated;
revoke execute on function athanor.seeking_to_identity(text[]) from public, anon, authenticated;
revoke execute on function athanor.pair_not_blocked(uuid, uuid) from public, anon, authenticated;

-- ── 2. Expiry — the deck is a daily three, not a backlog (#273 B) ────────────

create function public.expire_momento_proposals()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_deleted int := 0;
begin
  -- 7 days: a member who has not opened the app for a week has not "not decided" on
  -- these three people, they were never shown them. DELETE rather than auto-pass —
  -- `passed` would set passed_until = proposed_on + 90 and suppress a pair nobody
  -- ever rejected. Deleting frees the pair for the very next run.
  delete from public.momento_proposals
   where status = 'pending'
     and proposed_on < (now() at time zone 'utc')::date - 7;
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

comment on function public.expire_momento_proposals() is
  'Deletes pending proposals older than 7 days (#273 B). Called at the top of '
  'run_momenti_matcher(), so it rides the existing 03:11 UTC cron rather than adding '
  'a schedule. DELETE, not auto-pass: an unseen proposal must not burn the 90-day '
  'suppression window.';

revoke execute on function public.expire_momento_proposals() from public, anon, authenticated;

-- ── 3. The matcher (#273 A, C, E) ───────────────────────────────────────────
--
-- SCALE CEILING (#273 F, recorded not fixed): `recipients × profiles` is an unbounded
-- cross join and the per-pair work is four array intersects. It is a nightly batch
-- with no user waiting on it, and at the low thousands of active dreamers it is a
-- few million pair evaluations — seconds. It becomes the wrong shape somewhere in the
-- tens of thousands, where the fix is a prefilter (candidates sharing at least one
-- tag, via an inverted index on identity_tags/seeking) rather than a faster scoring
-- expression. A and C reduce the rows that SURVIVE scoring, not the join cost.
create or replace function public.run_momenti_matcher()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inserted int := 0;
  v_fallback int := 0;
  v_today date := (now() at time zone 'utc')::date;
begin
  perform public.expire_momento_proposals();

  -- ── affinity pass ──
  with recipients as (
    select p.id as user_id, p.identity_tags, p.seeking,
           (select count(*) from public.momento_proposals mp
             where mp.user_id = p.id
               and mp.proposed_on = v_today)::int as today_count
      from public.profiles p
     where exists (select 1 from public.dreams d
                    where d.profile_id = p.id and d.status = 'active' and d.deleted_at is null)
       and (select count(*) from public.momento_proposals mp
             where mp.user_id = p.id
               and mp.proposed_on = v_today) < 3
  ),
  scored as (
    select r.user_id, r.today_count, c.id as candidate_id,
           -- you both are …
           athanor.tag_intersect(r.identity_tags, c_tags.v) as shared,
           -- … they are what you seek …
           athanor.tag_intersect(athanor.seeking_to_identity(r.seeking), c_tags.v) as seek_hit,
           -- … and you are what they seek.
           athanor.tag_intersect(r.identity_tags, athanor.seeking_to_identity(c_seek.v)) as offer_hit
      from recipients r
      join public.profiles c on c.id <> r.user_id
      cross join lateral (select case when coalesce(c.visibility ->> 'identity_tags', 'members') <> 'private'
                                      then c.identity_tags else '{}'::text[] end as v) c_tags
      cross join lateral (select case when coalesce(c.visibility ->> 'seeking', 'members') <> 'private'
                                      then c.seeking else '{}'::text[] end as v) c_seek
     where exists (select 1 from public.dreams d
                    where d.profile_id = c.id and d.status = 'active' and d.deleted_at is null)
       -- a private dream would be RLS-filtered out of the deck card, leaving a
       -- Momento with no dream text — don't propose the candidate at all.
       and coalesce(c.visibility ->> 'dream', 'members') <> 'private'
       -- a blocked pair renders nothing in the deck, so proposing it would burn one
       -- of the three daily slots on a card the recipient can never see.
       and athanor.pair_not_blocked(r.user_id, c.id)
       and not exists (
             select 1 from public.momento_proposals mp
              where mp.user_id = r.user_id and mp.candidate_id = c.id
                and (mp.passed_until is null or mp.passed_until > v_today))
  ),
  affin as (
    select user_id, today_count, candidate_id,
           (coalesce(array_length(shared,1),0)
            + coalesce(array_length(seek_hit,1),0)
            + coalesce(array_length(offer_hit,1),0))::numeric as affinity
      from scored
  ),
  ranked as (
    select *, row_number() over (partition by user_id order by affinity desc, candidate_id) as rnk
      from affin
     -- MOMENTO_AFFINITY_THRESHOLD (packages/core/src/onboarding/affinity.ts). Two
     -- terms, not one: with a 7-item identity vocabulary, a single overlap is a
     -- coincidence, not a reason to interrupt someone.
     where affinity >= 2
  )
  insert into public.momento_proposals
        (user_id, candidate_id, affinity, daily_rank, proposed_on)
  -- No `reasons`: the column keeps its '{}' default and the deck computes the terms
  -- at read time (#273 D). Nothing writes prose to it any more.
  select user_id, candidate_id,
         affinity, (today_count + rnk)::smallint, v_today
    from ranked
   where today_count + rnk <= 3
  on conflict (user_id, candidate_id) do nothing;

  get diagnostics v_inserted = row_count;

  -- ── dream-recency fallback (#273 E) ──
  -- Only for a member the affinity pass left with an EMPTY deck: no pending proposal
  -- at all, and room left under today's cap. One card, never three — this is the
  -- floor that keeps a rare-tag member from staring at momenti.none.body forever,
  -- not a second matcher.
  with starving as (
    select p.id as user_id,
           (select count(*) from public.momento_proposals mp
             where mp.user_id = p.id
               and mp.proposed_on = v_today)::int as today_count
      from public.profiles p
     where exists (select 1 from public.dreams d
                    where d.profile_id = p.id and d.status = 'active' and d.deleted_at is null)
       and not exists (select 1 from public.momento_proposals mp
                        where mp.user_id = p.id and mp.status = 'pending')
       and (select count(*) from public.momento_proposals mp
             where mp.user_id = p.id
               and mp.proposed_on = v_today) < 3
  ),
  pick as (
    select s.user_id, s.today_count, c.id as candidate_id,
           row_number() over (partition by s.user_id
                              order by d.created_at desc, c.id) as rnk
      from starving s
      join public.profiles c on c.id <> s.user_id
      join lateral (
        select dd.created_at
          from public.dreams dd
         where dd.profile_id = c.id and dd.status = 'active' and dd.deleted_at is null
         order by dd.created_at desc
         limit 1
      ) d on true
     where coalesce(c.visibility ->> 'dream', 'members') <> 'private'
       -- Same boundary as get_momenti_suggestion: a member who hid BOTH tag fields
       -- has opted out of tag matching, and this fallback must not walk around that.
       and not (coalesce(c.visibility ->> 'identity_tags', 'members') = 'private'
            and coalesce(c.visibility ->> 'seeking', 'members') = 'private')
       and athanor.pair_not_blocked(s.user_id, c.id)
       and not exists (
             select 1 from public.momento_proposals mp
              where mp.user_id = s.user_id and mp.candidate_id = c.id
                and (mp.passed_until is null or mp.passed_until > v_today))
  )
  insert into public.momento_proposals
        (user_id, candidate_id, affinity, daily_rank, proposed_on)
  -- affinity 0 IS the marker: get_momenti_deck() reads it back as reason_kind
  -- 'new_dream', so the card says «Sogno nuovo» instead of claiming an overlap.
  select user_id, candidate_id, 0, (today_count + 1)::smallint, v_today
    from pick
   where rnk = 1
  on conflict (user_id, candidate_id) do nothing;

  get diagnostics v_fallback = row_count;
  return v_inserted + v_fallback;
end;
$$;

comment on function public.run_momenti_matcher() is
  'Nightly Momenti matcher (03:11 UTC cron). Scores each recipient×candidate pair on '
  'three terms — shared identity, their identity answering your seeking, your '
  'identity answering theirs (#273 A) — and proposes at most 3/day above an affinity '
  'threshold of 2 (#273 C). A recipient the pass leaves with an empty deck gets one '
  'dream-recency card at affinity 0 instead (#273 E). Writes NO reason prose: '
  'get_momenti_deck() computes the terms at read time (#273 D). Expires pending '
  'proposals older than 7 days first (#273 B).';

revoke execute on function public.run_momenti_matcher() from public, anon, authenticated;

-- ── 4. The deck read path (#273 B, D) ───────────────────────────────────────
--
-- Replaces the client-side select in packages/api/src/momenti.ts, which ordered by
-- `daily_rank` alone across every day at once and read the frozen `reasons` text.
--
-- DEFINER for the same reason get_momenti_suggestion is: the reason terms depend on
-- profiles.visibility and on the candidate's tag columns, none of which authenticated
-- may read since the M10 column grant. Everything the caller's RLS would have done is
-- re-established inside: the caller is auth.uid() (never an argument), rows are their
-- own pending proposals, blocked pairs drop both ways, and a candidate's hidden field
-- comes back masked.
create function public.get_momenti_deck()
returns table (
  proposal_id  uuid,
  candidate_id uuid,
  handle       text,
  display_name text,
  avatar_path  text,
  dream_text   text,
  reason_kind  text,
  shared       text[],
  seek_hit     text[],
  offer_hit    text[]
)
language sql
stable
security definer
set search_path = ''
as $$
  with me as (
    select p.id, p.identity_tags, p.seeking
      from public.profiles p
     where p.id = (select auth.uid())
  )
  select
    mp.id,
    c.id,
    c.handle,
    c.display_name,
    c.avatar_path,
    d.text,
    -- The KIND, never the score: affinity stays server-only (rule #1). 0 is only ever
    -- written by the dream-recency fallback.
    case when mp.affinity = 0 then 'new_dream' else 'affinity' end,
    athanor.tag_intersect(me.identity_tags, c_tags.v),
    athanor.tag_intersect(athanor.seeking_to_identity(me.seeking), c_tags.v),
    athanor.tag_intersect(me.identity_tags, athanor.seeking_to_identity(c_seek.v))
  from public.momento_proposals mp
  join me on me.id = mp.user_id
  join public.profiles c on c.id = mp.candidate_id
  -- Recomputed and re-masked on every read — this is what retires the purge trigger.
  cross join lateral (select case when athanor.field_visible(c.id, 'identity_tags')
                                  then c.identity_tags else '{}'::text[] end as v) c_tags
  cross join lateral (select case when athanor.field_visible(c.id, 'seeking')
                                  then c.seeking else '{}'::text[] end as v) c_seek
  -- A Momento with no dream has nothing to answer, so an archived or hidden dream
  -- drops the card rather than rendering it empty (the client used to do this).
  join lateral (
    select dd.text
      from public.dreams dd
     where dd.profile_id = c.id and dd.status = 'active' and dd.deleted_at is null
     order by dd.created_at desc
     limit 1
  ) d on true
  where (select auth.uid()) is not null
    and mp.status = 'pending'
    and athanor.not_blocked(c.id)
    and athanor.field_visible(c.id, 'dream')
  -- #273 B: newest DAY first, then the rank within that day. `daily_rank` restarts at
  -- 1 every night, so ordering by it alone returned an arbitrary trio drawn from every
  -- day's rank-1 rows at once.
  order by mp.proposed_on desc, mp.daily_rank asc
  limit 3;
$$;

comment on function public.get_momenti_deck() is
  'Today-first deck of at most 3 pending Momenti for the caller, with the affinity '
  'terms RECOMPUTED at read time from the candidate''s current, visibility-masked tags '
  '(#273 D) — the client localizes them from tag.identity.* + momenti.reason.*. '
  'reason_kind is ''new_dream'' for a dream-recency fallback card and ''affinity'' '
  'otherwise; the affinity NUMBER is never returned (rule #1). DEFINER because '
  'profiles.visibility and the tag columns are not readable by authenticated; the '
  'caller comes from auth.uid(), blocked pairs drop both ways.';

revoke execute on function public.get_momenti_deck() from public, anon;
grant execute on function public.get_momenti_deck() to authenticated;

-- The deck index followed the old order (user_id, status, daily_rank) — it can still
-- satisfy the filter, but not the sort, now that the day leads it (#273 B).
drop index if exists public.momento_proposals_deck;
create index momento_proposals_deck
  on public.momento_proposals (user_id, status, proposed_on desc, daily_rank);

-- ── 5. Retire the frozen-prose apparatus (#273 D) ───────────────────────────
--
-- momento_reasons() froze a locale-mixed string at insert. Two of its three terms
-- named the CANDIDATE's tags, so the text went stale the moment they edited or hid
-- them — and 20260807201350 + 20260807203343 exist only to delete or blank rows whose
-- prose had rotted. get_momenti_deck() computes the terms live, so the rot is not
-- possible any more and the machinery treating it has nothing left to do.
--
-- The trade this gives back, recorded because 20260807203343 L94-99 recorded its
-- opposite: a pending proposal now SURVIVES a candidate hiding their tags. The card
-- stays, correctly masked, with no affinity line — instead of vanishing mid-session
-- and being re-proposed with a fresh push on the next run.

drop trigger profiles_purge_momenti on public.profiles;
drop function athanor.purge_stale_momento_proposals();

-- Nothing writes this column any more; blank the prose already stored so no deck,
-- export or admin view can serve a frozen string again.
update public.momento_proposals set reasons = '{}' where reasons <> '{}';

drop function public.momento_reasons(text, text[], text[], text[]);

comment on column public.momento_proposals.reasons is
  'RETIRED (#273 D). Was a frozen, half-localized prose snapshot; the deck now '
  'computes its terms at read time in get_momenti_deck(). Nothing writes it — the '
  'column stays only so an older client that still selects it keeps parsing (it reads '
  'as an empty list, i.e. a card with no affinity lines).';
