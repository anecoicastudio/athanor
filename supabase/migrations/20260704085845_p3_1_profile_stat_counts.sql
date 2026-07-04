-- P3.1 — profile stat-line counts (collabs / events attended) for any profile.
--
-- Why a DEFINER RPC: milestone_helps is party-scoped (helper or dream owner)
-- and event_attendance/event_tickets are holder/organizer-scoped, so another
-- user's counts are not client-readable under RLS. This function exposes ONLY
-- two aggregates — never rows, never ids — and respects block invisibility
-- via athanor.not_blocked() (blocked either way → no row, client coalesces 0).
--
-- Count semantics:
--   collabs = completed, non-deleted milestone_helps as helper (an offered or
--             declined help is not a collaboration — mirrors the M6 engine
--             which awards help_completed only on status='completed').
--   events  = distinct events with a check-in (event_attendance) on a ticket
--             held by the profile — "attended", not tickets bought.

create function public.profile_stat_counts(p_profile_id uuid)
returns table (collabs_count integer, events_count integer)
language sql
stable
security definer
set search_path = ''
as $$
  select
    (select count(*)::int
       from public.milestone_helps h
      where h.helper_id = p_profile_id
        and h.status = 'completed'
        and h.deleted_at is null),
    (select count(distinct a.event_id)::int
       from public.event_attendance a
       join public.event_tickets t on t.id = a.ticket_id
      where t.user_id = p_profile_id)
  where (select auth.uid()) is not null
    and athanor.not_blocked(p_profile_id)
$$;

comment on function public.profile_stat_counts(uuid) is
  'Aggregate-only profile stats (collabs completed as helper, distinct events attended). SECURITY DEFINER because the source tables are party/holder-scoped; exposes counts only, gated on auth + athanor.not_blocked.';

revoke execute on function public.profile_stat_counts(uuid) from public, anon;
grant execute on function public.profile_stat_counts(uuid) to authenticated;
