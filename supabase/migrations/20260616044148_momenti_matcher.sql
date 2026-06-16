-- M5 Momenti · the nightly matcher (v1 deterministic SQL scoring; 11 §3.2).
-- Affinity = identity_tags / seeking set-overlap (the schema has no city/profession/skills cols,
-- so the spec's city-proximity / dream-keyword↔skills terms are out of scope until those land).
-- Runs as SECURITY DEFINER (writes proposals as the table owner, bypassing the no-INSERT client grant),
-- scheduled nightly by pg_cron (the prune-expired-stories precedent). Not client-callable.

-- Locale-aware reason strings, authored server-side and shown verbatim (PRD §4.7). Up to 3.
-- The overlapping tag KEYS are embedded directly (curated short tokens); proper tag→label
-- localization is deferred — the keys are human-legible enough for v1.
create function public.momento_reasons(
  p_locale text,
  p_shared text[],     -- identity_tags ∩ identity_tags (you both are)
  p_seek_hit text[],   -- my seeking ∩ their identity_tags (you seek what they are)
  p_offer_hit text[]   -- my identity_tags ∩ their seeking (they may seek what you are)
)
returns text[]
language plpgsql
immutable
set search_path = ''
as $$
declare
  out text[] := '{}';
  it boolean := (p_locale = 'it');
begin
  if array_length(p_shared, 1) is not null then
    out := out || (case when it then 'Condividete: ' else 'You share: ' end
                   || array_to_string(p_shared, ', '));
  end if;
  if array_length(p_seek_hit, 1) is not null then
    out := out || (case when it then 'Cerchi: ' else 'You''re seeking: ' end
                   || array_to_string(p_seek_hit, ', '));
  end if;
  if array_length(p_offer_hit, 1) is not null then
    out := out || (case when it then 'Potrebbe cercare ciò che offri: ' else 'May seek what you offer: ' end
                   || array_to_string(p_offer_hit, ', '));
  end if;
  return out[1:3];   -- at most 3 (matches the card's 3 affinity rows)
end;
$$;

create function public.run_momenti_matcher()
returns integer            -- count of proposals inserted this run
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inserted int := 0;
begin
  with recipients as (
    select p.id as user_id, p.locale, p.identity_tags, p.seeking
      from public.profiles p
     where exists (select 1 from public.dreams d
                    where d.profile_id = p.id and d.status = 'active' and d.deleted_at is null)
       -- only fill remaining slots: skip users already at the ≤3/day cap
       and (select count(*) from public.momento_proposals mp
             where mp.user_id = p.id
               and mp.proposed_on = (now() at time zone 'utc')::date) < 3
  ),
  scored as (
    select r.user_id, r.locale, c.id as candidate_id,
           array(select unnest(r.identity_tags) intersect select unnest(c.identity_tags)) as shared,
           array(select unnest(r.seeking)       intersect select unnest(c.identity_tags)) as seek_hit,
           array(select unnest(r.identity_tags) intersect select unnest(c.seeking))       as offer_hit
      from recipients r
      join public.profiles c on c.id <> r.user_id
     where exists (select 1 from public.dreams d
                    where d.profile_id = c.id and d.status = 'active' and d.deleted_at is null)
       -- never re-propose: skip any existing pair, and honor a live pass window
       and not exists (
             select 1 from public.momento_proposals mp
              where mp.user_id = r.user_id and mp.candidate_id = c.id
                and (mp.passed_until is null or mp.passed_until > (now() at time zone 'utc')::date))
  ),
  affin as (
    select user_id, locale, candidate_id, shared, seek_hit, offer_hit,
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
         affinity, rnk::smallint, (now() at time zone 'utc')::date
    from ranked
   where rnk <= 3
  on conflict (user_id, candidate_id) do nothing;   -- belt-and-braces vs the dedupe index

  get diagnostics v_inserted = row_count;
  return v_inserted;
end;
$$;

revoke execute on function public.momento_reasons(text, text[], text[], text[]) from public, anon, authenticated;
revoke execute on function public.run_momenti_matcher() from public, anon, authenticated;
-- service_role keeps execute (default for the owner); pg_cron runs in the postgres context.

-- Nightly schedule (03:11 UTC, off-peak; mirrors prune-expired-story-segments).
create extension if not exists pg_cron;
select cron.schedule(
  'momenti-matcher-nightly',
  '11 3 * * *',
  $$ select public.run_momenti_matcher() $$
);
