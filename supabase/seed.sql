-- Local dev seed: two members. Passwords unusable (magic-link flows only).
insert into auth.users (instance_id, id, aud, role, email, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', 'aaaaaaaa-0000-0000-0000-000000000001',
   'authenticated', 'authenticated', 'sole@athanor.local', '{"locale":"it"}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'aaaaaaaa-0000-0000-0000-000000000002',
   'authenticated', 'authenticated', 'luna@athanor.local', '{"locale":"en"}'::jsonb, now(), now())
on conflict (id) do nothing;

update public.profiles
set handle = 'sole', bio = 'Designer. Il mio sogno: aprire uno studio a Milano.'
where id = 'aaaaaaaa-0000-0000-0000-000000000001';

update public.profiles
set handle = 'luna', bio = 'Developer. My dream: launch a wellbeing app.'
where id = 'aaaaaaaa-0000-0000-0000-000000000002';

-- public-handle-ssr: make `sole` renderable on the public @handle page (dev smoke only)
update public.profiles
  set visibility = '{"bio":"public","dream":"public"}'::jsonb
  where handle = 'sole';

insert into public.dreams (profile_id, text, status)
  select id, 'Aprire uno studio che lavori solo su progetti che lasciano il mondo un po'' più chiaro.', 'active'
  from public.profiles where handle = 'sole'
  on conflict do nothing;

insert into public.dream_milestones (dream_id, body, position)
  select d.id, 'Un logo', 0
  from public.dreams d join public.profiles p on p.id = d.profile_id
  where p.handle = 'sole' and d.status = 'active'
  on conflict do nothing;

-- M5 Momenti demo: a couple of pending proposals so the swipe deck renders in local dev.
-- (seed.sql is local-only; on hosted, run select public.run_momenti_matcher();)
-- Give both members tags + an active dream so they are real matcher-eligible profiles, then
-- hand-author two reciprocal pending proposals (sole↔luna) — the deck has cards from the first run.
--
-- The tags come from the curated vocabularies (packages/core/src/onboarding/tags.ts) and are
-- COMPLEMENTARY, not identical: since #273 the matcher expands `seeking` through
-- athanor.seeking_to_identity() and the deck renders the resulting terms, so an off-list tag
-- ('design', 'music' — what this seed used to carry) scores nothing and renders a card with no
-- affinity lines. sole is what luna seeks and vice versa.
update public.profiles
  set identity_tags = array['creativo','freelance'], seeking = array['mentorship']
  where handle = 'sole';
update public.profiles
  set identity_tags = array['coach','mentor'], seeking = array['collaborazioni']
  where handle = 'luna';

insert into public.dreams (profile_id, text, status)
  select id, 'Launch a wellbeing app that helps people sleep.', 'active'
  from public.profiles where handle = 'luna'
  on conflict do nothing;

-- No `reasons`: the column is retired (#273 D). get_momenti_deck() computes the terms from the
-- candidate's current tags on every read, so a seeded string would be dead weight.

-- sole sees luna (sole seeks mentorship, luna is coach+mentor)
insert into public.momento_proposals (user_id, candidate_id, affinity, daily_rank)
select a.id, b.id, 4, 1
from public.profiles a, public.profiles b
where a.handle = 'sole' and b.handle = 'luna'
on conflict do nothing;

-- luna sees sole (luna seeks collaborazioni, sole is creativo+freelance)
insert into public.momento_proposals (user_id, candidate_id, affinity, daily_rank)
select a.id, b.id, 4, 1
from public.profiles a, public.profiles b
where a.handle = 'luna' and b.handle = 'sole'
on conflict do nothing;

-- remote_config: boot-time kill-switch defaults (fail-open: no force-update, not in maintenance).
-- Local-dev only; the hosted defaults are set via MCP (see the release runbook). on conflict = idempotent.
insert into public.remote_config (key, value) values
  ('min_app_version',          '{"ios":"1.0.0","android":"1.0.0"}'::jsonb),
  ('maintenance_mode',         '{"enabled":false,"eta":null}'::jsonb),
  ('fund_contributions_enabled','{"enabled":false}'::jsonb),
  ('prime_stelle_enabled',     '{"enabled":false}'::jsonb)
on conflict (key) do nothing;
