-- get_momenti_suggestion: rank by the DREAM's recency, plus two input-handling fixes.
--
-- 20260808035852 ordered by `p.updated_at desc` and described that as "newest
-- member". It is not: profiles_touch_updated_at (20260612172941 L28-30) fires on
-- every profile UPDATE, and server-side writes bump it too — identity_verified
-- from the Stripe Identity webhook, founding_member, push_enabled, referral_code.
-- A member who joined two years ago and edited their bio a minute ago sorted
-- first. The UI chip that labels this row therefore could not be made true: it
-- claimed «Alta affinità» (a ranking that is not computed at all), and relabelling
-- it «Nuovo qui» would only have moved the same unearned claim one column over.
--
-- Ordering now follows the newest active DREAM. That is the signal the row is
-- actually about — the card shows a dream — it rotates as members write dreams
-- rather than freezing on the newest signup, and it makes the chip («Sogno nuovo»
-- / «New dream») true by construction.
--
-- Also fixed here:
--   - a NULL inside p_exclude made `not (p.id = any(p_exclude))` evaluate to NULL
--     for every row, silently returning nothing. The app cannot send one
--     (candidateId is non-nullable) but any client can, and it failed silently
--     rather than loudly. The NOT EXISTS form is NULL-safe.
--   - p_exclude was unbounded, so a large array was a cheap way to make a
--     member's Momenti tab expensive. Clamped to 50; the deck is capped at 3.
--
-- Everything else is unchanged and still load-bearing — see 20260808035852 for
-- why this is SECURITY DEFINER and what its body must re-establish (blocks via
-- athanor.field_visible, dream visibility, caller identity from auth.uid()).
--
-- Erratum for 20260808035852 (append-only, corrected in MIGRATIONS-ERRATA.md):
-- its header says a both-tags-private member is one who "leaves every deck".
-- They leave every OTHER member's deck; they still receive one of their own,
-- scored against their own private tags (tests/0073).

create or replace function public.get_momenti_suggestion(p_exclude uuid[] default '{}')
returns table (candidate_id uuid, handle text, dream_text text)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.handle, d.text
    from public.profiles p
    join lateral (
      select dd.text, dd.created_at
        from public.dreams dd
       where dd.profile_id = p.id
         and dd.status = 'active'
         and dd.deleted_at is null
       order by dd.created_at desc
       limit 1
    ) d on true
   where (select auth.uid()) is not null
     and p.id <> (select auth.uid())
     -- NOT EXISTS over a clamped array: NULL-safe, and bounded work per call.
     and not exists (
       select 1 from unnest((coalesce(p_exclude, '{}'::uuid[]))[1:50]) x where x = p.id
     )
     and athanor.field_visible(p.id, 'dream')
     and not (coalesce(p.visibility ->> 'identity_tags', 'members') = 'private'
          and coalesce(p.visibility ->> 'seeking', 'members') = 'private')
   order by d.created_at desc
   limit 1;
$$;

comment on function public.get_momenti_suggestion(uuid[]) is
  'Curated-lite «Ti potrebbe interessare» peer: the most recently written active dream, '
  'excluding the caller, today''s deck, blocked peers, and members who hid BOTH tag fields. '
  'Ordered by dream recency, NOT affinity — no affinity is computed here (a suggestions table '
  'is deferred since M5), which is why the UI chip says «Sogno nuovo». '
  'DEFINER because profiles.visibility is not readable by authenticated (M10 column grant).';
