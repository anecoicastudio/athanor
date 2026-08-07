-- Purge pending Momento proposals when a candidate hides a tag field.
--
-- `momento_proposals.reasons` is a text[] snapshot authored at match time by
-- public.momento_reasons() (20260616044148 L7-39). It splices the RAW tag keys —
-- only the prefix is localized («Cerchi: music») — and two of its three terms are
-- candidate-derived: seek_hit intersects the candidate's identity_tags, offer_hit
-- their seeking. So the stored text names the candidate's tags, and the deck
-- renders it verbatim (MomentoCard.tsx -> AffinityRow).
--
-- Nothing refreshed that snapshot. run_momenti_matcher() excludes any candidate
-- that already has a row (20260807174758 L104-107) and its insert ends
-- `on conflict (user_id, candidate_id) do nothing`, so an existing row is never
-- re-evaluated or re-authored — the text stayed stale INDEFINITELY, until the
-- recipient accepted or passed. A member who hid their tags kept them spelled out
-- in other people's decks.
--
-- Fix: delete the candidate's PENDING proposals the moment either tag field
-- transitions to 'private'. Deleting (rather than rewriting the text) is what
-- makes it self-healing — the row is the thing blocking re-proposal, so removing
-- it lets the nightly matcher (03:11 UTC) propose again with correctly masked
-- reasons if affinity survives. Rewriting in place would leave rows whose every
-- term masked out, rendering a card with no affinity lines at all.
--
-- Scope is deliberately `status = 'pending'`:
--   - accepted rows have a conversation hanging off them (accept_momento ->
--     create_conversation_pair, 20260616123408 L191-216);
--   - passed rows carry passed_until = proposed_on + 90, which must keep
--     suppressing re-proposal for the full window (20260616042201 L66-91).
--
-- SECURITY DEFINER is required, not stylistic: the member flipping their own
-- visibility is `authenticated`, and that role has no DELETE grant and no DELETE
-- policy on momento_proposals at all (20260616042622, and the create migration's
-- own note "NO insert policy, NO delete policy"). Shape follows the existing
-- reactive-profiles trigger athanor.aura_award_identity_verified()
-- (20260701124122 L126-135). Adds NO policy, so the exact policies_are() list in
-- tests/0027 stays true.

create function athanor.purge_stale_momento_proposals()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Absent key = 'members' (the canonical default, matching field_visible and the
  -- edit UI). Only a transition INTO private fires: re-saving a profile that was
  -- already private must not keep deleting freshly-matched proposals.
  if new.visibility is distinct from old.visibility
     and ((coalesce(new.visibility ->> 'identity_tags', 'members') = 'private'
           and coalesce(old.visibility ->> 'identity_tags', 'members') is distinct from 'private')
       or (coalesce(new.visibility ->> 'seeking', 'members') = 'private'
           and coalesce(old.visibility ->> 'seeking', 'members') is distinct from 'private'))
  then
    delete from public.momento_proposals
     where candidate_id = new.id
       and status = 'pending';
  end if;
  return new;
end;
$$;

revoke execute on function athanor.purge_stale_momento_proposals() from public, anon, authenticated;

-- AFTER: the delete is a side effect, not a veto on the profile write. Uses the
-- candidate-side index momento_proposals_candidate_id_idx (20260701160202 L39-40).
create trigger profiles_purge_momenti
  after update on public.profiles
  for each row execute function athanor.purge_stale_momento_proposals();
