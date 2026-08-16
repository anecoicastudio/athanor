-- #227 follow-up — a privileged read of fund_candidate_cards must not raise 42501.
--
-- 20260816151600 granted EXECUTE on athanor.dream_confirmed_counts to `authenticated` only,
-- which is right for the ballot and wrong for everyone else who can legitimately read the
-- view. The lateral is part of the view now, so `select … from public.fund_candidate_cards`
-- as service_role failed outright with «permission denied for function
-- dream_confirmed_counts» — not a null history, a broken read of every column. Caught by the
-- pgTAP assertion added for exactly this reader.
grant execute on function athanor.dream_confirmed_counts(uuid) to service_role;

-- And with the grant in place the `auth.uid() is not null` clause becomes actively harmful.
-- It was copied from public.profile_stat_counts, where the function is a CLIENT-CALLABLE rpc
-- in `public` and the check is a real second gate. Here it is not: `athanor` is not an exposed
-- schema, so this function has no PostgREST surface, EXECUTE is revoked from public and anon,
-- and the view itself is revoked from anon. The grant IS the gate. What the clause added was
-- a service-role reader silently seeing NULL history on rows it can otherwise read in full —
-- the same «a false answer produced by an access rule rather than by the facts» shape the
-- original migration exists to eliminate, just aimed at a different reader.
--
-- Everything else is verbatim: the aggregate-only shape, the confirmed-states-only predicate,
-- and the no-row-for-a-dead-dream branch (which is what keeps «no dream linked» and «a linked
-- dream with nothing confirmed» distinguishable at the boundary).
create or replace function athanor.dream_confirmed_counts(p_dream_id uuid)
returns table (milestones_done integer, helps_confirmed integer)
language sql
stable
security definer
set search_path = ''
as $$
  select
    (select count(*)::int
       from public.dream_milestones m
      where m.dream_id = p_dream_id
        and m.status = 'done'
        and m.deleted_at is null),
    (select count(*)::int
       from public.milestone_helps h
       join public.dream_milestones m on m.id = h.milestone_id
      where m.dream_id = p_dream_id
        and m.deleted_at is null
        and h.status = 'completed'
        and h.deleted_at is null)
  where p_dream_id is not null
    and exists (
      select 1 from public.dreams d
      where d.id = p_dream_id and d.deleted_at is null
    )
$$;

comment on function athanor.dream_confirmed_counts(uuid) is
  '#227/FUND-50: aggregate-only confirmed history of a linked dream (milestones done, helps completed). SECURITY DEFINER because milestone_helps is party-scoped and a voter is neither party — a plain join would silently count zero. Exposes counts only; no row when the dream is absent or soft-deleted. Access is the grant (authenticated + service_role; anon revoked, athanor is not an exposed schema), not an auth.uid() check inside the body.';

-- CREATE OR REPLACE keeps grants, so both roles carry EXECUTE from here on; restated for the
-- reader who lands on this file rather than the one above it.
revoke execute on function athanor.dream_confirmed_counts(uuid) from public, anon;
grant execute on function athanor.dream_confirmed_counts(uuid) to authenticated, service_role;
