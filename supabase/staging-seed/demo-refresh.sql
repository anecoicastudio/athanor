-- Athanor — STAGING demo world: the hourly keep-alive for what demo-world.sql adds.
--
-- refresh-staging.sql already keeps the base seed alive, and its persona set is derived from
-- the mail domain, so the twelve demo people get Momenti decks, moderation resets and the rest
-- for free. What it cannot know about are the rows demo-world.sql adds beyond the base seed's
-- frozen lists, and two kinds of those age out on their own:
--
--   stories  six 24h segments — expired, they vanish from the rail, and the nightly reaper
--            then deletes their bytes, so a later re-run of demo-world.sql brings back rows
--            with no media behind them.
--   events   five upcoming events at +3…+13 days — each quietly becomes a past event.
--
-- This installs public.staging_refresh_demo() and a cron at :37 (half an hour away from
-- staging-refresh-world at :07). Same shape as that function: SECURITY DEFINER, self-gated on
-- the staging Vault marker, diff-aware (an untouched hour writes nothing), service_role only.
-- Same two install gates as every file in this directory. Never production.
--
-- ⚠ gen:types: the next `pnpm gen:types` adds `staging_refresh_demo` to database.types.ts
-- `Functions`, exactly as it does for staging_refresh_world. Expected, not schema drift.

begin;

do $$
begin
  if coalesce(athanor.runtime_setting('environment'), '') <> 'staging' then
    raise exception 'REFUSING TO INSTALL: the environment marker is %, expected ''staging''.',
      coalesce(athanor.runtime_setting('environment'), '<unset>');
  end if;
  if coalesce(current_setting('app.settings.seed_confirm', true), '') <> 'yes' then
    raise exception 'REFUSING TO INSTALL: run "set app.settings.seed_confirm = ''yes'';" in this session first.';
  end if;
end $$;

create or replace function public.staging_refresh_demo()
returns jsonb
language plpgsql
-- SECURITY DEFINER for staging_refresh_world()'s reason: the pg_cron calling context holds no
-- direct grant on these tables.
security definer
set search_path = ''
as $$
declare
  v_stories int := 0;
  v_events  int := 0;
begin
  if coalesce(athanor.runtime_setting('environment'), '') <> 'staging' then
    return jsonb_build_object('skipped', 'environment marker is not staging');
  end if;

  -- Stories: the same 4-hour window refresh-staging.sql §9 uses, so the countdown visibly
  -- ticks 20h → 4h in the app, idle hours write nothing, and the 03:17 prune never wins.
  update public.story_segments
     set expires_at = now() + interval '20 hours', deleted_at = null
   where id in (select md5('story:' || h || ':1')::uuid
                  from unnest(array['ines_dance', 'omar_bread', 'zoe_murals',
                                    'noah_climbs', 'hana_garden', 'leo_bikes']) as h)
     and (expires_at < now() + interval '4 hours' or deleted_at is not null);
  get diagnostics v_stories = row_count;

  -- Events: once one comes within a day of starting, push it back to its demo-world.sql
  -- offset (counted from the current hour), clearing any live-window state and its stats row the way
  -- refresh-staging.sql §10 does. RSVPs ride along untouched.
  with restamped as (
    update public.events e
       set starts_at = date_trunc('hour', now()) + (x.days || ' days')::interval + (x.hour || ' hours')::interval,
           ends_at   = date_trunc('hour', now()) + (x.days || ' days')::interval + ((x.hour + 3) || ' hours')::interval,
           live_started_at = null, live_ended_at = null, deleted_at = null
      from (values
        ('repair-cafe', 3, 0), ('bread-night', 6, 2), ('founders-evening', 7, 1),
        ('rooftop-harvest', 11, 0), ('mural-jam', 13, 0)
      ) as x(slug, days, hour)
     where e.id = md5('event:' || x.slug)::uuid
       and (e.starts_at < now() + interval '1 day' or e.deleted_at is not null)
    returning e.id
  ),
  wiped as (
    delete from public.event_live_stats s using restamped r where s.event_id = r.id
  )
  select count(*) into v_events from restamped;

  return jsonb_build_object('stories_revived', v_stories, 'events_restamped', v_events);
end;
$$;

revoke all on function public.staging_refresh_demo() from public, anon, authenticated;
grant execute on function public.staging_refresh_demo() to service_role;

create extension if not exists pg_cron;
select cron.unschedule(jobid) from cron.job where jobname = 'staging-refresh-demo';
select cron.schedule('staging-refresh-demo', '37 * * * *', $$ select public.staging_refresh_demo() $$);

commit;

select public.staging_refresh_demo() as first_run;
select jobname, schedule, active from cron.job where jobname like 'staging-refresh%' order by jobname;
