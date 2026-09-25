-- #735 review follow-up, same PR: a 'retained' row must never starve a fresh request.
--
-- Why a second migration rather than an edit to 20260925175902: that file was committed before
-- /code-review ran, and a committed migration is append-only here whether or not any project has
-- applied it. Both ship together, and the function body below is the only change.
--
-- 20260925175902 let the claim re-take 'retained' rows, but kept `order by created_at, id` under
-- `limit p_limit`. A retained row is by construction older than anything filed since it first
-- ran, so once twenty of them pile up — a rotated-away Stripe key on a night twenty Circle
-- subscribers ask to leave — every pass claims the same twenty, they fail again, and no NEWER
-- request, subscribed or not, is ever claimed. Before #735 those rows went terminal and left the
-- queue; re-claiming them must not cost the rest of it.
--
-- The fix is one sort key: 'retained' rows sort after every 'requested' and stale 'processing'
-- row, so a pass fills its batch with first attempts and re-drives only with what is left.
-- Among retained rows, the one retried longest ago goes first (`updated_at`, which the terminal
-- write stamps through the touch trigger), so a stuck head cannot hold the tail back either.

create or replace function public.claim_erasure_requests(
  p_limit int default 20,
  p_lease interval default interval '15 minutes'
)
returns table (id uuid, profile_id uuid, claimed_at timestamptz)
language sql
security invoker
set search_path = ''
as $$
  with candidates as materialized (
    select r.id, r.profile_id, r.created_at, r.status, r.updated_at
      from public.gdpr_erasure_requests r
     where (
             r.status in ('requested', 'retained')
             or (r.status = 'processing'
                 and (r.claimed_at is null or r.claimed_at < now() - p_lease))
           )
       and not exists (
         select 1
           from public.gdpr_erasure_requests live
          where live.profile_id is not null
            and live.profile_id = r.profile_id
            and live.id <> r.id
            and live.status = 'processing'
            and live.claimed_at is not null
            and live.claimed_at >= now() - p_lease
       )
     order by (r.status = 'retained'),
              case when r.status = 'retained' then r.updated_at end,
              r.created_at, r.id
     limit p_limit
     for update skip locked
  ),
  deduped as (
    select distinct on (coalesce(c.profile_id::text, 'req:' || c.id::text)) c.id
      from candidates c
     where pg_catalog.pg_try_advisory_xact_lock(
             pg_catalog.hashtextextended(
               'gdpr_erasure_requests:' || coalesce(c.profile_id::text, 'req:' || c.id::text), 0))
     order by coalesce(c.profile_id::text, 'req:' || c.id::text),
              (c.status = 'retained'), c.created_at, c.id
  )
  update public.gdpr_erasure_requests t
     set status = 'processing',
         claimed_at = now()
    from deduped d
   where t.id = d.id
  returning t.id, t.profile_id, t.claimed_at;
$$;

comment on function public.claim_erasure_requests(int, interval) is
  'Atomically claim up to p_limit erasure requests for one erasure-job pass (#717): every ''requested'' and ''retained'' (#735) row, plus every ''processing'' row whose claim is older than p_lease or absent, at most one per member. ''retained'' rows sort after every first attempt (20260925181256), least recently retried first, so a backlog of Stripe-blocked requests can never starve a fresh one. ''failed'', ''partial'' and ''done'' are never re-claimed. Returns the claimed rows with the status already flipped to ''processing'' and the stamp it took, which the caller MUST fence its terminal write on — a pass whose lease expired mid-cascade would otherwise write over a row a later pass now owns. p_lease must exceed the edge-function wall clock — 150s free, 400s paid (https://supabase.com/docs/guides/functions/limits) — or a live pass re-claims its own rows; the 15-minute default is 2.25x the paid ceiling. Two overlapping calls never return the same row, and never return two rows of one member; a caller that loses the race for a member simply does not see them this pass. To release a stuck lease by hand, null the row''s claimed_at (RELEASE-RUNBOOK §7.5) — do NOT pass a zero lease, which re-stamps the rows and hides them from the pass you are about to invoke. Service-role only.';

revoke execute on function public.claim_erasure_requests(int, interval) from public, anon, authenticated;
grant execute on function public.claim_erasure_requests(int, interval) to service_role;
