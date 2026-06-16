-- Fix: continue daily_rank from the recipient's existing today-count instead of restarting at 1,
-- so an intra-day re-run (manual invoke / cron retry) of a partially-filled user can't collide on the
-- momento_proposals_daily_cap (user_id, proposed_on, daily_rank) unique index. The ≤3/day cap is now
-- expressed directly as `today_count + rnk <= 3`. SECURITY DEFINER + search_path='' unchanged.
create or replace function public.run_momenti_matcher()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inserted int := 0;
begin
  with recipients as (
    select p.id as user_id, p.locale, p.identity_tags, p.seeking,
           (select count(*) from public.momento_proposals mp
             where mp.user_id = p.id
               and mp.proposed_on = (now() at time zone 'utc')::date)::int as today_count
      from public.profiles p
     where exists (select 1 from public.dreams d
                    where d.profile_id = p.id and d.status = 'active' and d.deleted_at is null)
       and (select count(*) from public.momento_proposals mp
             where mp.user_id = p.id
               and mp.proposed_on = (now() at time zone 'utc')::date) < 3
  ),
  scored as (
    select r.user_id, r.locale, r.today_count, c.id as candidate_id,
           array(select unnest(r.identity_tags) intersect select unnest(c.identity_tags)) as shared,
           array(select unnest(r.seeking)       intersect select unnest(c.identity_tags)) as seek_hit,
           array(select unnest(r.identity_tags) intersect select unnest(c.seeking))       as offer_hit
      from recipients r
      join public.profiles c on c.id <> r.user_id
     where exists (select 1 from public.dreams d
                    where d.profile_id = c.id and d.status = 'active' and d.deleted_at is null)
       and not exists (
             select 1 from public.momento_proposals mp
              where mp.user_id = r.user_id and mp.candidate_id = c.id
                and (mp.passed_until is null or mp.passed_until > (now() at time zone 'utc')::date))
  ),
  affin as (
    select user_id, locale, today_count, candidate_id, shared, seek_hit, offer_hit,
           (coalesce(array_length(shared,1),0)
            + coalesce(array_length(seek_hit,1),0)
            + coalesce(array_length(offer_hit,1),0))::numeric as affinity
      from scored
  ),
  ranked as (
    select *, row_number() over (partition by user_id order by affinity desc, candidate_id) as rnk
      from affin
     where affinity > 0
  )
  insert into public.momento_proposals
        (user_id, candidate_id, reasons, affinity, daily_rank, proposed_on)
  select user_id, candidate_id,
         public.momento_reasons(locale, shared, seek_hit, offer_hit),
         affinity, (today_count + rnk)::smallint, (now() at time zone 'utc')::date
    from ranked
   where today_count + rnk <= 3
  on conflict (user_id, candidate_id) do nothing;

  get diagnostics v_inserted = row_count;
  return v_inserted;
end;
$$;
