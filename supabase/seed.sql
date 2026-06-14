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
