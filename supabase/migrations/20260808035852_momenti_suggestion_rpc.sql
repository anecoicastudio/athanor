-- «Ti potrebbe interessare» moves behind an RPC so it can respect tag visibility.
--
-- The client used to build this query itself (packages/api getMomentiSuggestion):
-- newest profile with an active dream, ordered by updated_at. It had no
-- tag-visibility predicate, so a member who set BOTH identity_tags and seeking
-- to 'private' — the point at which affinity hits 0 and they leave every deck —
-- still surfaced here. It could not have had one: M10 column-scoped the
-- authenticated SELECT grant on profiles (20260807170813 L66-68), so
-- `visibility` is not readable by the client at all.
--
-- SECURITY DEFINER because of that grant. Which means the RLS that used to supply
-- three guarantees is now bypassed and each has to be re-established in the body:
--
--   1. BLOCKS. The old query inherited profiles_select_authenticated,
--      `using (athanor.not_blocked(id))` (20260619222420 L75).
--      athanor.field_visible() folds not_blocked into itself (20260807170813
--      L49), so the dream gate below carries it. Do NOT "simplify" that call to a
--      raw `visibility ->> 'dream'` check — that silently drops mutual
--      invisibility, and pgTAP 0075 asserts both directions.
--   2. DREAM VISIBILITY. Was the dreams SELECT policy; field_visible(id,'dream')
--      is the canonical replacement and keeps the members-by-default behaviour.
--   3. CALLER IDENTITY. From auth.uid(), never a parameter (rule #8). p_exclude
--      carries only the ids already on screen in today's deck.
--
-- The predicate is BOTH fields private, not either: that is the affinity-0
-- boundary (hiding identity_tags alone leaves offer_hit live — persona E in
-- tests/0073), and it is what profile.visibility.tagsPrivateHint promises.
--
-- Ordering is unchanged: `updated_at desc limit 1` — recency, not affinity. Real
-- affinity-ranked curation still needs a suggestions table (deferred since M5).
-- The UI chip was relabelled «Nuovo qui» in the same change to stop claiming a
-- ranking this query does not compute.

create function public.get_momenti_suggestion(p_exclude uuid[] default '{}')
returns table (candidate_id uuid, handle text, dream_text text)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.handle, d.text
    from public.profiles p
    join lateral (
      select dd.text
        from public.dreams dd
       where dd.profile_id = p.id
         and dd.status = 'active'
         and dd.deleted_at is null
       order by dd.created_at desc
       limit 1
    ) d on true
   where (select auth.uid()) is not null
     and p.id <> (select auth.uid())
     and not (p.id = any (coalesce(p_exclude, '{}')))
     and athanor.field_visible(p.id, 'dream')
     and not (coalesce(p.visibility ->> 'identity_tags', 'members') = 'private'
          and coalesce(p.visibility ->> 'seeking', 'members') = 'private')
   order by p.updated_at desc
   limit 1;
$$;

revoke execute on function public.get_momenti_suggestion(uuid[]) from public, anon;
grant execute on function public.get_momenti_suggestion(uuid[]) to authenticated;

comment on function public.get_momenti_suggestion(uuid[]) is
  'Curated-lite «Ti potrebbe interessare» peer: newest member with a visible active dream, '
  'excluding the caller, today''s deck, blocked peers, and members who hid BOTH tag fields. '
  'DEFINER because profiles.visibility is not readable by authenticated (M10 column grant).';
