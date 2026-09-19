-- Athanor — STAGING demo world, step 2 of 2: English, and twelve more people.
--
-- A presentation layer over seed-staging.sql, for recording a product walkthrough on staging.
-- It changes no schema and nothing outside the staging project. Order, on an emptied project:
--
--   1. demo-fund-edition.sql          (English fund edition — must exist before the seed)
--   2. seed-staging.sql               (the twelve-persona world)
--   3. demo-world.sql                 (this file)
--   4. refresh-staging.sql            (hourly restore cron; this file's rows survive it —
--                                      the refresh restores statuses and dates, never text)
--   5. pnpm staging:demo-media --confirm   (bytes for every key below)
--   6. demo-refresh.sql               (once: the hourly keep-alive for this file's stories/events)
--
-- Every file is gated like seed-staging.sql: the Vault environment marker AND
-- `set app.settings.seed_confirm = 'yes'` typed in the same session.
--
-- WHAT IT DOES
--   §1  twelve new signable people (<handle>@staging.athanor.local / Athanor2026!), and every one
--       of the twenty-four profiles in English — bio, profession, city, mission, skills, avatar.
--   §2  the seeded world's text rewritten in English, row by row, by the seed's own md5 ids.
--   §3  new content: dreams, milestones, posts, stories, events, chats, Momenti cards, votes.
--   §4  real Aura. Nothing here writes aura_events or aura_scores (rule 1). It fires the same
--       M6 triggers the app fires — a milestone reaching done, a help completed, a ten-message
--       conversation, a post starred, an invite activated — and the score-engine does the rest.
--       This deliberately overrides seed-staging.sql's "Aura has to be earned in the app"
--       stance: a demo needs a community whose reputation already has a spread.
--
-- Re-runnable: inserts end in `on conflict do nothing`, updates are keyed by id. Re-running
-- seed-staging.sql after this file puts the seeded profile bios back in Italian (its §1 UPDATE is
-- unconditional); run this file again afterwards.
--
-- STORIES AND EVENTS AGE. The six stories and five events §3 adds are not in
-- refresh-staging.sql's frozen lists; demo-refresh.sql installs the hourly cron that keeps them
-- current. Without it the stories expire 20 hours after the last run of this file.

begin;

do $$
begin
  if coalesce(athanor.runtime_setting('environment'), '') <> 'staging' then
    raise exception 'REFUSING: the environment marker is %, expected ''staging''.',
      coalesce(athanor.runtime_setting('environment'), '<unset>');
  end if;
  if coalesce(current_setting('app.settings.seed_confirm', true), '') <> 'yes' then
    raise exception 'REFUSING: run "set app.settings.seed_confirm = ''yes'';" in this session first.';
  end if;
  if not exists (select 1 from public.profiles where id = md5('user:sole_designer')::uuid) then
    raise exception 'REFUSING: seed-staging.sql has not run on this project — run it first.';
  end if;
end $$;

-- ---------------------------------------------------------------------------------
-- 1. People
-- ---------------------------------------------------------------------------------
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
select
  '00000000-0000-0000-0000-000000000000',
  md5('user:' || p.handle)::uuid,
  'authenticated', 'authenticated',
  p.handle || '@staging.athanor.local',
  extensions.crypt('Athanor2026!', extensions.gen_salt('bf')),
  now() - (p.age_days || ' days')::interval,
  '', '', '', '',
  '{"provider":"email","providers":["email"]}'::jsonb,
  jsonb_build_object('locale', 'en', 'display_name', p.display_name),
  now() - (p.age_days || ' days')::interval,
  now()
from (values
  ('noah_climbs',    'Noah Bennett',     36),
  ('amara_textiles', 'Amara Okafor',     34),
  ('leo_bikes',      'Leo Mensah',       31),
  ('hana_garden',    'Hana Sato',        29),
  ('theo_code',      'Theo Laurent',     27),
  ('ines_dance',     'Inês Duarte',      24),
  ('omar_bread',     'Omar Haddad',      21),
  ('clara_books',    'Clara Weber',      18),
  ('jonas_sound',    'Jonas Berg',       15),
  ('priya_care',     'Priya Nair',       11),
  ('sam_mentor',     'Samuel Adeyemi',    9),
  ('zoe_murals',     'Zoe Martin',        5)
) as p(handle, display_name, age_days)
on conflict do nothing;

insert into auth.identities (id, provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
select md5('identity:' || u.email)::uuid, u.id::text, u.id,
       jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true),
       'email', null, u.created_at, u.created_at
from auth.users u
where u.email like '%@staging.athanor.local'
on conflict do nothing;

-- All twenty-four, English. identity_tags / seeking / skills are the curated keys of
-- packages/core/src/onboarding/{tags,skills}.ts — the app renders them through i18n and drops
-- anything off-list. identity_verified and founding_member are left as seed-staging.sql set them.
-- Every profile gets a face: {uid}/{uid}.jpg, the seed's own avatar key shape.
update public.profiles pr set
  handle = p.handle,
  bio = p.bio,
  profession = p.profession,
  city = p.city,
  mission = p.mission,
  locale = 'en',
  identity_tags = p.identity_tags,
  seeking = p.seeking,
  skills = p.skills,
  visibility = '{"bio":"public","dream":"public"}'::jsonb,
  referral_code = upper(left(md5('ref:' || p.handle), 8)),
  birth_date = coalesce(pr.birth_date,
    date '1970-01-01' + (('x' || left(md5('dob:' || p.handle), 7))::bit(28)::int % 12784)),
  display_name = athanor.normalize_display_name(
    (select u.raw_user_meta_data ->> 'display_name' from auth.users u where u.id = pr.id)),
  avatar_path = pr.id::text || '/' || pr.id::text || '.jpg'
from (values
  ('sole_designer',  'Designer. Small studio, projects that leave the world a little clearer.',        'Brand designer',          'Milano',  'Design only what I believe in, and live from it.',                 array['creativo','freelance'],       array['collaborazioni','connessioni'], array['branding','ui-ux','illustrazione']),
  ('luna_dev',       'Developer. Building things that help people sleep better.',                        'Mobile developer',        'Milano',  'Software that gives people their evenings back.',                  array['freelance','creativo'],       array['collaborazioni','crescita'],    array['sviluppo-mobile','sviluppo-web','dati']),
  ('marta_ceramica', 'Ceramicist. Wheel, glazes, and a kiln that deserves to be fired more often.',     'Ceramicist',              'Milano',  'A workshop where anyone can learn to make something that lasts.',  array['artista','freelance'],        array['business','connessioni'],       array['fotografia','social-media']),
  ('gio_musica',     'Producer. I record in a basement with great acoustics and terrible wifi.',         'Music producer',          'Milano',  'Records made where the musicians actually live.',                  array['artista','creativo'],         array['collaborazioni','eventi'],      array['produzione-musicale','sound-design']),
  ('ele_yoga',       'Yoga teacher. I take the practice where it usually does not reach.',               'Yoga teacher',            'Milano',  'Movement for the people everyone forgot to invite.',               array['coach','freelance'],          array['connessioni','eventi'],         array['coaching','facilitazione']),
  ('tino_chef',      'Chef. Looking for producers who make things the way they used to.',                'Chef',                    'Milano',  'Cook what the valley gives, and pay the people who grow it.',      array['imprenditore','creativo'],    array['business','collaborazioni'],    array['cucina','vendite']),
  ('vera_erbe',      'Herbalist. I pick, I dry, I listen.',                                              'Herbalist',               'Como',    'Keep the knowledge of the paths alive, one plant at a time.',      array['artista','freelance'],        array['crescita','connessioni'],       array['fotografia','storytelling']),
  ('rocco_film',     'Filmmaker. Short documentaries about crafts that are disappearing.',               'Documentary filmmaker',   'Genova',  'Film the hands before the hands are gone.',                        array['artista','creativo'],         array['collaborazioni','crescita'],    array['videomaking','montaggio','storytelling']),
  ('sara_startup',   'Founder. Second time around, slower on purpose.',                                  'Founder',                 'Milano',  'A company that is still good to work at when it is forty people.', array['imprenditore','investitore'], array['mentorship','business'],        array['fundraising','project-management','vendite']),
  ('dario_legno',    'Carpenter. Reclaimed wood, visible joints, no screws.',                            'Carpenter',               'Bergamo', 'Teach the trade to the ones nobody else will hire.',               array['artista','mentor'],           array['eventi','collaborazioni'],      array['falegnameria','facilitazione']),
  ('nina_poeta',     'I write. Mostly at night, mostly by hand.',                                        'Poet',                    'Milano',  'Poems that get read aloud, not scrolled past.',                    array['creativo','artista'],         array['crescita','connessioni'],       array['copywriting','storytelling','traduzione']),
  ('bea_foto',       'Photographer. Long portraits, film when I can.',                                   'Photographer',            'Milano',  'A portrait of every workshop in the old town before it closes.',   array['freelance','artista'],        array['collaborazioni','eventi'],      array['fotografia','montaggio']),
  ('noah_climbs',    'Climbing coach. I teach kids to fall well before I teach them to go up.',          'Climbing coach',          'Milano',  'A wall for every kid who cannot afford the gym.',                  array['coach','mentor'],             array['connessioni','eventi'],         array['coaching','facilitazione']),
  ('amara_textiles', 'Textile designer. Weaving on a loom older than me.',                               'Textile designer',        'Torino',  'Fabric made together by people who arrived and people who stayed.', array['artista','imprenditore'],    array['collaborazioni','business'],    array['illustrazione','branding']),
  ('leo_bikes',      'Bike mechanic. Every bike deserves a second life.',                                'Bike mechanic',           'Milano',  'A repair café in every neighbourhood of the city.',                array['imprenditore','mentor'],      array['collaborazioni','eventi'],      array['facilitazione','project-management']),
  ('hana_garden',    'Urban gardener. Tomatoes on rooftops, compost in the stairwell.',                  'Urban gardener',          'Milano',  'Rooftops that feed the building below them.',                      array['creativo','freelance'],       array['connessioni','collaborazioni'], array['facilitazione','social-media']),
  ('theo_code',      'Developer. I write small tools for people who fix things.',                        'Open-source developer',   'Milano',  'Software for the people who keep things working.',                array['freelance','creativo'],       array['collaborazioni','crescita'],    array['sviluppo-web','dati','no-code']),
  ('ines_dance',     'Dancer. I choreograph for people who think they cannot dance.',                    'Choreographer',           'Milano',  'A stage big enough for a whole neighbourhood.',                    array['artista','coach'],            array['eventi','connessioni'],         array['facilitazione','storytelling']),
  ('omar_bread',     'Baker. Night shifts, long fermentation, short conversations.',                     'Baker',                   'Bologna', 'A bakery that trains young people and pays them properly.',        array['imprenditore','mentor'],      array['business','mentorship'],        array['cucina','vendite']),
  ('clara_books',    'Bookbinder and bookseller. Paper, thread and patience.',                           'Bookbinder',              'Milano',  'Books that outlive the phones we read them on.',                   array['artista','imprenditore'],     array['collaborazioni','eventi'],      array['copywriting','illustrazione']),
  ('jonas_sound',    'Field recordist. I collect the sounds a city forgets it makes.',                   'Field recordist',         'Milano',  'An archive of the city you can listen to.',                        array['artista','freelance'],        array['collaborazioni','crescita'],    array['sound-design','produzione-musicale']),
  ('priya_care',     'Nurse, twelve years in emergency. Now building something slower.',                 'Nurse',                   'Milano',  'Care for the people who fall between the cracks.',                 array['coach','imprenditore'],       array['mentorship','connessioni'],     array['coaching','project-management']),
  ('sam_mentor',     'Retired engineer. Forty years of bridges; now I help people build their first thing.', 'Mentor, retired engineer', 'Milano', 'Fifty first-time founders before I turn seventy.',             array['mentor','investitore'],       array['mentorship','connessioni'],     array['project-management','contabilita','fundraising']),
  ('zoe_murals',     'Muralist. Walls are the only gallery everyone can enter.',                         'Muralist',                'Milano',  'Paint the city with the faces of the people who live in it.',      array['artista','creativo'],         array['collaborazioni','eventi'],      array['illustrazione','branding'])
) as p(handle, bio, profession, city, mission, identity_tags, seeking, skills)
where pr.id = md5('user:' || p.handle)::uuid;

insert into public.consent (id, profile_id, kind, granted, granted_at, source)
select md5('consent:' || pr.handle || ':' || k.kind)::uuid, pr.id, k.kind, k.granted, now(), 'signup'
from public.profiles pr
cross join (values ('comms', true), ('analytics', false), ('location_approx', true)) as k(kind, granted)
where pr.id = md5('user:' || pr.handle)::uuid
on conflict do nothing;

insert into public.notification_preferences (id, profile_id, type, channel, enabled)
select md5('notifpref:' || pr.handle || ':' || t.type)::uuid, pr.id, t.type, 'push', true
from public.profiles pr
cross join (values ('moment'), ('dreamMilestone'), ('connection'), ('eventReminder')) as t(type)
where pr.id = md5('user:' || pr.handle)::uuid
on conflict do nothing;

-- ---------------------------------------------------------------------------------
-- 2. The seeded world, in English — by the seed's own ids.
-- ---------------------------------------------------------------------------------
update public.dreams d set text = x.text
from (values
  ('sole_designer',  'Open a studio that only takes projects I believe in, and make a living from it.'),
  ('marta_ceramica', 'A kiln of my own, in a workshop with the right light, open to anyone who wants to learn.'),
  ('gio_musica',     'Produce a whole album without leaving my region.'),
  ('ele_yoga',       'Bring yoga to care homes, once a week, for free.'),
  ('tino_chef',      'An eight-seat inn with one menu: whatever today brought.'),
  ('vera_erbe',      'A proper herbarium of the paths above the village. Printed, not a PDF.'),
  ('rocco_film',     'Film the last five shipwrights left on the coast.'),
  ('dario_legno',    'Teach ten kids to make a joint without a single nail.'),
  ('nina_poeta',     'Finish the collection. Then find someone to read it aloud.'),
  ('bea_foto',       'A portrait of every workshop left in the old town, before they close.')
) as x(handle, text)
where d.id = md5('dream:' || x.handle)::uuid;

update public.dream_milestones m set body = x.body
from (values
  ('sole_designer',  0, 'Find the space'),
  ('sole_designer',  1, 'Three clients who actually pay'),
  ('sole_designer',  2, 'A partner who is good with numbers'),
  ('marta_ceramica', 0, 'Get a quote for the kiln'),
  ('marta_ceramica', 1, 'Figure out where to put it'),
  ('gio_musica',     0, 'Treat the room acoustically'),
  ('gio_musica',     1, 'Find a patient sound engineer'),
  ('ele_yoga',       0, 'Talk to the first care home'),
  ('ele_yoga',       1, 'Find two teachers to take turns'),
  ('rocco_film',     0, 'Find the first shipwright'),
  ('rocco_film',     1, 'A camera that makes no noise')
) as x(handle, position, body)
where m.id = md5('ms:' || x.handle || ':' || x.position)::uuid;

-- milestone_helps_guard and favor_offers_guard let a member change only a status, and both key on
-- current_user: the service path is the one role they exempt. Rewriting the seed's text is exactly
-- that kind of non-member edit, so these two statements run as service_role.
set local role service_role;
update public.milestone_helps h set message = x.message
from (values
  ('sara_startup', 'sole_designer',  1, 'I will help you with the quotes, I wrote them for two years.'),
  ('bea_foto',     'marta_ceramica', 1, 'I know who rents the warehouse behind the station.'),
  ('dario_legno',  'marta_ceramica', 0, 'I will help you wire it in, I did the same in my workshop.'),
  ('gio_musica',   'rocco_film',     1, 'I have a silent camera and a patient engineer.'),
  ('dario_legno',  'ele_yoga',       1, 'My aunt runs a care home ten minutes away.')
) as x(helper, ms_handle, ms_pos, message)
where h.id = md5('help:' || x.helper || ':' || x.ms_handle || ':' || x.ms_pos)::uuid;

update public.favor_offers f set need = x.need
from (values
  ('tino_chef',  'ele_yoga',      'I can introduce you to two care homes, I cater for both.'),
  ('nina_poeta', 'rocco_film',    'I will write the voice-over, if you need one.'),
  ('luna_dev',   'sole_designer', 'I will build your website in an afternoon.')
) as x(actor, target, need)
where f.id = md5('favor:' || x.actor || ':' || x.target)::uuid;
reset role;

update public.projects p set title = x.title, description = x.description, terms = x.terms
from (values
  ('sara_startup', 'Cerco co-founder tecnico',          'Looking for a technical co-founder', 'Product already validated with twenty paying customers. I need someone who knows how to say no.', 'Equity, not salary. Let''s talk.'),
  ('rocco_film',   'Documentario sui maestri d''ascia', 'Documentary: the last shipwrights',  'Five twelve-minute episodes. The first shipwright has already said yes.',                         'Symbolic fee plus credits.'),
  ('tino_chef',    'Locanda a otto coperti',            'An eight-seat inn',                  'Looking for someone with an empty room in the old town and an appetite for risk.',                'Rent as a share of takings.'),
  ('vera_erbe',    'Mapping the paths',                 'Mapping the paths',                  'I need people who walk and photograph. Two Saturdays a month.',                                    'No pay, just lunch.'),
  ('luna_dev',     'Sleep study, small n',              'Sleep study, small n',               'Looking for someone with a research background to design the protocol properly.',                  'Co-authorship.')
) as x(handle, seed_title, title, description, terms)
where p.id = md5('project:' || x.handle || ':' || x.seed_title)::uuid;

update public.events e set title = x.title, description = x.description, venue = coalesce(x.venue, e.venue)
from (values
  ('cena-condivisa',   'Shared dinner: we cook together',          'Twelve seats, one long table. Everyone brings an ingredient and a story; Tino turns them into dinner.', 'Cascina Bianca'),
  ('yoga-alba',        'Sunrise practice on the rooftop',          'Forty-five minutes of slow practice as the city wakes up. Mats provided, beginners welcome.',          'Rooftop, via Volta'),
  ('ascolto-disco',    'Guided listening: the whole album',        'We listen to the new record from start to finish, then Gio tells us how every track was made.',        null),
  ('athanor-ottobre',  'Athanor Day: the day that counts',         'The yearly gathering. The Fund winners are announced, and the community meets in person.',             'Spazio Ostro'),
  ('bottega-aperta',   'Open workshop: visible joints',            'Dario opens the workshop for an evening. Watch a joint being cut, then try one yourself.',             'Fontana Woodshop'),
  ('promemoria-oggi',  'Tonight''s circle',                        'An evening circle to share what moved this week. Tea and cushions provided.',                           'Main Hall'),
  ('diretta-tra-poco', 'Live: starting soon',                      'A short live session from the basement studio. Questions welcome in the chat.',                         null),
  ('bottega-tra-poco', 'Workshop opening: starting soon',          'The workshop doors open in a moment. Come as you are.',                                                  'Fontana Woodshop')
) as x(slug, title, description, venue)
where e.id = md5('event:' || x.slug)::uuid;

update public.posts p set body = x.body, tags = x.tags
from (values
  ('sole_designer',  'Signed for the space. Three rooms, and one window that is worth the rent.',          array['studio']),
  ('marta_ceramica', 'First firing in the new kiln. Two pieces cracked, the third one is the one.',       array['ceramics']),
  ('ele_yoga',       'Seven of us at the care home today. Last week we were two.',                         array['yoga']),
  ('rocco_film',     'Shot the first one. Eighty-six years old, hand saw, never once looked at the camera.', array['documentary']),
  ('luna_dev',       'Week two retention: 11 of 20. Not great. Better than week one of the old build.',     array['product']),
  ('sara_startup',   'Said no to an investor today. First time it felt like the easy call.',              array['founder']),
  ('tino_chef',      'Found my butter maker. Forty kilos a week, and not a gram more.',                   array['cooking']),
  ('vera_erbe',      'Dried the season''s first yarrow. Smells like hay and pepper.',                     array['herbs']),
  ('dario_legno',    'The youngest kid''s first joint. Crooked, but it holds.',                           array['wood']),
  ('nina_poeta',     'Cut forty lines. The poem is shorter and it finally breathes.',                     array['writing']),
  ('bea_foto',       'The haberdashery on via Sant''Agnese closes in December. I photographed him yesterday.', array['portrait']),
  ('gio_musica',     'Treated the room with twelve home-made panels. The reverb is gone.',                array['audio'])
) as x(handle, body, tags)
where p.id = md5('post:' || x.handle || ':1')::uuid;

update public.post_comments c set body = x.body
from (values
  ('bea_foto',      'marta_ceramica', 'If you like, I will come and photograph the next firing.'),
  ('tino_chef',     'vera_erbe',      'Would you use yarrow in cooking, or only in tea?'),
  ('sara_startup',  'luna_dev',       'Eleven of twenty is a real number. Most people never look.'),
  ('nina_poeta',    'bea_foto',       'I will write something for it, if you let me keep looking at the photo.'),
  ('sole_designer', 'dario_legno',    'Crooked but it holds is exactly how my first logo came out.')
) as x(commenter, post_handle, body)
where c.id = md5('comment:' || x.commenter || ':' || x.post_handle)::uuid;

-- Stories: English captions, and the real length of the replacement clips
-- (docs/test-stories/demo — duration_s paces the viewer's progress bar).
update public.story_segments s set caption = x.caption, duration_s = coalesce(x.duration_s, s.duration_s)
from (values
  ('marta_ceramica', 1, 'The wheel at six in the morning.',                  10),
  ('tino_chef',      1, 'Forty kilos of butter, and that is all.',           null),
  ('bea_foto',       1, 'Last day of good light.',                           null),
  ('dario_legno',    1, 'The bench at seven in the morning.',                null),
  ('dario_legno',    2, 'The kid finished his first joint.',                 12),
  ('ele_yoga',       1, 'Headstand on the pier. Three breaths, then down.',  null),
  ('vera_erbe',      1, 'This one dries in four days. The smell comes later.', null),
  ('gio_musica',     1, 'The basement at eleven at night.',                  9),
  ('sole_designer',  1, 'First visit to the space. Measuring everything twice.', 10)
) as x(handle, n, caption, duration_s)
where s.id = md5('story:' || x.handle || ':' || x.n)::uuid;

update public.messages m set body = x.body
from (values
  ('sole_designer',  'luna_dev',   1, 'I saw your dream. I will build your website, really.'),
  ('sole_designer',  'luna_dev',   2, 'Deal. What do you want in return?'),
  ('sole_designer',  'luna_dev',   3, 'That you tell me the truth about my portfolio.'),
  ('sole_designer',  'luna_dev',   4, 'That is a worse deal for you. Thursday?'),
  ('sole_designer',  'luna_dev',   5, 'Thursday it is.'),
  ('marta_ceramica', 'bea_foto',   1, 'When are you firing the kiln? I would love to be there.'),
  ('marta_ceramica', 'bea_foto',   2, 'Thursday at six. It is still dark, bring your tripod.'),
  ('marta_ceramica', 'bea_foto',   3, 'I will bring the big camera.'),
  ('marta_ceramica', 'bea_foto',   4, 'The haberdashery, yesterday. So you see it before the kiln.'),
  ('rocco_film',     'gio_musica', 1, 'For the documentary: the basement is soundproofed now.'),
  ('rocco_film',     'gio_musica', 2, 'When can I come and listen?'),
  ('rocco_film',     'gio_musica', 3, 'The room is free on Tuesday.')
) as x(a, b, n, body)
where m.id = md5('msg:' || x.a || ':' || x.b || ':' || x.n)::uuid;

update public.moments m set caption = x.caption, duration_s = coalesce(x.duration_s, m.duration_s)
from (values
  ('sole_designer',  'The keys.',               null),
  ('marta_ceramica', 'Glazed, finally.',        10),
  ('tino_chef',      'The right butter.',       null),
  ('rocco_film',     'Eighty-six years old.',   null),
  ('dario_legno',    'It holds.',               null)
) as x(handle, caption, duration_s)
where m.id = md5('moment:' || x.handle)::uuid;

update public.dream_candidacies c set story = x.story, goal = x.goal, impact = x.impact, plan = x.plan
from (values
  ('marta_ceramica', 'I have made ceramics for eleven years in a rented studio I now have to leave.',  'A kiln of my own and a workshop open to anyone who wants to learn.', 'Eight courses a year, free for those who cannot pay.',       'A second-hand kiln, the wiring, six months of rent.'),
  ('ele_yoga',       'I have taught yoga for six years. For two, I have taught it in a care home, for free.', 'Reach five care homes, with teachers who get paid.',       'Two hundred people who would otherwise never leave the house.', 'Training for four teachers, one year of their fees.'),
  ('rocco_film',     'I film crafts that are disappearing. Five shipwrights are left on the coast.',   'Five finished episodes, distributed.',                             'An archive of things that will be gone in ten years.',      'Equipment, travel, editing.')
) as x(handle, story, goal, impact, plan)
where c.id = md5('candidacy:' || x.handle)::uuid;

update public.reports r set note = x.note
from (values
  ('sell-1',  'Looks like they are selling a course in the comments.'),
  ('mlm-1',   'Messaged me privately about an "income system".'),
  ('spam-1',  'Third identical post in two days.'),
  ('other-1', 'Keeps insisting after I said no.')
) as x(slug, note)
where r.id = md5('report:' || x.slug)::uuid;

-- sole_designer's post now carries the studio moodboard (post type must follow the media row).
insert into public.post_media (id, post_id, kind, storage_path, position, width, height)
select md5('postmedia:' || h || ':0')::uuid, md5('post:' || h || ':1')::uuid, 'image'::public.media_kind,
       md5('user:' || h)::uuid::text || '/' || md5('post:' || h || ':1')::uuid::text || '/0.jpg', 0, 1080, 1350
from unnest(array['sole_designer']) as h
on conflict do nothing;
update public.posts set type = 'image' where id = md5('post:sole_designer:1')::uuid;

-- ---------------------------------------------------------------------------------
-- 3. New content
-- ---------------------------------------------------------------------------------
insert into public.dreams (id, profile_id, text, status)
select md5('dream:' || d.handle)::uuid, md5('user:' || d.handle)::uuid, d.text, 'active'
from (values
  ('noah_climbs',    'A free bouldering hour every week for kids who cannot afford the gym.'),
  ('amara_textiles', 'A shared weaving studio where newcomers and locals make fabric together.'),
  ('leo_bikes',      'A repair café in every neighbourhood of Milan by 2028.'),
  ('hana_garden',    'Turn ten empty rooftops into gardens that feed the building below.'),
  ('theo_code',      'Open software for repair cafés, so nobody keeps the inventory on paper again.'),
  ('ines_dance',     'A dance piece performed by thirty neighbours who have never been on a stage.'),
  ('omar_bread',     'A bakery that trains young people with no papers, and pays them properly.'),
  ('clara_books',    'Print and bind a book of recipes from every grandmother on my street.'),
  ('jonas_sound',    'A sound map of the city before the old trams are retired.'),
  ('priya_care',     'A free evening clinic for the people who fall between the cracks.'),
  ('sam_mentor',     'Mentor fifty first-time founders before I turn seventy.'),
  ('zoe_murals',     'Paint the station underpass with the faces of the people who walk through it.')
) as d(handle, text)
on conflict do nothing;

-- Milestones are inserted in_progress and the finished ones then moved to done: the transition is
-- what the M6 trigger aura_award_own_milestone listens for, exactly as when a member ticks one off.
insert into public.dream_milestones (id, dream_id, body, status, position)
select md5('ms:' || m.handle || ':' || m.position)::uuid, md5('dream:' || m.handle)::uuid,
       m.body, 'in_progress'::public.milestone_status, m.position
from (values
  ('noah_climbs',    0, 'One gym gives us the wall on Sundays'),
  ('noah_climbs',    1, 'Climbing shoes in twenty sizes'),
  ('amara_textiles', 0, 'Rescue two looms from a closing mill'),
  ('amara_textiles', 1, 'A room with good light'),
  ('leo_bikes',      0, 'The first Saturday repair café'),
  ('leo_bikes',      1, 'Train five volunteer mechanics'),
  ('hana_garden',    0, 'First rooftop harvest'),
  ('hana_garden',    1, 'A second building says yes'),
  ('theo_code',      0, 'Talk to five repair cafés'),
  ('theo_code',      1, 'Ship the first version'),
  ('ines_dance',     0, 'Find thirty brave neighbours'),
  ('ines_dance',     1, 'A stage for one night'),
  ('omar_bread',     0, 'Two apprentices on contract'),
  ('omar_bread',     1, 'A second oven'),
  ('clara_books',    0, 'Collect forty recipes'),
  ('clara_books',    1, 'Bind the first hundred copies'),
  ('jonas_sound',    0, 'Record every tram line'),
  ('jonas_sound',    1, 'Publish the map'),
  ('priya_care',     0, 'Three volunteer doctors'),
  ('priya_care',     1, 'A room, two evenings a week'),
  ('sam_mentor',     0, 'The first ten founders'),
  ('sam_mentor',     1, 'A monthly open evening'),
  ('zoe_murals',     0, 'Permission from the city'),
  ('zoe_murals',     1, 'Photograph two hundred faces')
) as m(handle, position, body)
on conflict do nothing;

update public.dream_milestones set status = 'done'
 where id in (select md5('ms:' || h || ':0')::uuid from unnest(array[
   'noah_climbs','amara_textiles','leo_bikes','hana_garden','theo_code','ines_dance',
   'omar_bread','clara_books','jonas_sound','priya_care','sam_mentor','zoe_murals']) as h)
   and status <> 'done';

-- Help between people, completed — aura_award_milestone_help pays the helper on the transition.
insert into public.milestone_helps (id, milestone_id, helper_id, type, message, status)
select md5('help:' || h.helper || ':' || h.ms_handle || ':' || h.ms_pos)::uuid,
       md5('ms:' || h.ms_handle || ':' || h.ms_pos)::uuid, md5('user:' || h.helper)::uuid,
       h.type::public.help_type, h.message, 'accepted'::public.help_status
from (values
  ('theo_code',   'leo_bikes',      1, 'skill',       'I will build the booking page for the volunteers.'),
  ('jonas_sound', 'gio_musica',     1, 'skill',       'I can engineer the sessions. Patient is my middle name.'),
  ('sam_mentor',  'sole_designer',  2, 'skill',       'Forty years of budgets. Let me look at your numbers.'),
  ('priya_care',  'ele_yoga',       1, 'connection',  'Two nurses from my ward teach yoga on weekends.'),
  ('tino_chef',   'omar_bread',     0, 'opportunity', 'My supplier trains apprentices, I will introduce you.'),
  ('amara_textiles', 'marta_ceramica', 1, 'connection', 'The mill I rescued the looms from has a kiln room.'),
  ('zoe_murals',  'ines_dance',     1, 'opportunity', 'The underpass has a stage-sized wall. Dance under my mural.'),
  ('leo_bikes',   'noah_climbs',    1, 'connection',  'The shop next to mine resoles climbing shoes for cheap.'),
  ('clara_books', 'hana_garden',    1, 'connection',  'My landlord owns the building opposite. I will ask him.'),
  ('omar_bread',  'priya_care',     1, 'opportunity', 'The back room of the bakery is empty two evenings a week.')
) as h(helper, ms_handle, ms_pos, type, message)
on conflict do nothing;

update public.milestone_helps set status = 'completed'
 where id in (
   select md5('help:' || x.helper || ':' || x.ms_handle || ':' || x.ms_pos)::uuid
   from (values ('theo_code','leo_bikes',1), ('jonas_sound','gio_musica',1), ('sam_mentor','sole_designer',2),
                ('priya_care','ele_yoga',1), ('tino_chef','omar_bread',0), ('amara_textiles','marta_ceramica',1),
                ('leo_bikes','noah_climbs',1), ('omar_bread','priya_care',1)) as x(helper, ms_handle, ms_pos))
   and status <> 'completed';

insert into public.projects (id, author_id, title, category, description, terms, status)
select md5('project:' || p.handle || ':' || p.title)::uuid, md5('user:' || p.handle)::uuid,
       p.title, p.category::public.project_category, p.description, p.terms, 'open'::public.project_status
from (values
  ('theo_code',   'Repair café inventory, open source', 'startup',   'A tiny app to track what came in, what got fixed, and who fixed it. Looking for a designer.', 'Open source. Credits and pizza.'),
  ('ines_dance',  'Thirty neighbours on stage',         'artistic',  'A community dance piece for people who have never performed. Looking for a sound designer and a venue.', 'Paid from the ticket sales.'),
  ('priya_care',  'An evening clinic',                  'volunteer', 'Two evenings a week of free check-ups. I need doctors, a receptionist, and someone good with rotas.', 'Volunteer. Dinner is on the bakery.'),
  ('hana_garden', 'Soil sensors for rooftop gardens',   'scientific','Cheap sensors that tell a building when its garden is thirsty. Looking for someone who solders.', 'Shared ownership of the design.')
) as p(handle, title, category, description, terms)
on conflict do nothing;

insert into public.events (id, organizer_id, title, description, category, is_online, venue, city, geo, stream_url,
                           starts_at, ends_at, capacity, price_cents, currency, is_athanor_day)
select md5('event:' || e.slug)::uuid, md5('user:' || e.handle)::uuid, e.title, e.description,
       e.category::public.event_category, e.is_online, e.venue, e.city,
       case when e.is_online then null else extensions.st_point(e.lng, e.lat)::extensions.geography end,
       e.stream_url,
       date_trunc('hour', now()) + (e.days || ' days')::interval + (e.hour || ' hours')::interval,
       date_trunc('hour', now()) + (e.days || ' days')::interval + ((e.hour + 3) || ' hours')::interval,
       e.capacity, 0, 'eur', false
from (values
  ('repair-cafe',     'leo_bikes',   'Repair café: bring your broken bike', 'Bring the bike that has been in the cellar since 2019. We fix it together, you learn how, nobody pays.', 'formazione', false, 'Ciclofficina Lambrate',  'Milano',  9.25,  45.475, null, 3, 0, 25),
  ('bread-night',     'omar_bread',  'Night bakery: bake your first loaf',  'From ten at night to two in the morning. Flour, fire, and a loaf you made with your own hands.',         'creativi',   false, 'Forno Haddad',           'Bologna', 11.35, 44.5,   null, 6, 2, 12),
  ('founders-evening','sam_mentor',  'First-time founders: an honest evening', 'An hour of questions nobody asks at pitch events. Bring the one that keeps you up at night.',       'business',   true,  null,                     null,      null,  null,   'https://example.invalid/live/founders', 7, 1, 60),
  ('rooftop-harvest', 'hana_garden', 'Rooftop harvest and shared lunch',    'We pick what the roof gave us this month and cook it together on the terrace.',                          'benessere',  false, 'Rooftop, via Padova',    'Milano',  9.225, 45.5,   null, 11, 0, 30),
  ('mural-jam',       'zoe_murals',  'Mural jam under the station',         'Paint a face in the underpass. No experience needed: I sketch, you fill, we sign it together.',           'arte',       false, 'Lambrate underpass',     'Milano',  9.25,  45.475, null, 13, 0, 40)
) as e(slug, handle, title, description, category, is_online, venue, city, lng, lat, stream_url, days, hour, capacity)
on conflict do nothing;

insert into public.rsvps (id, user_id, event_id, status)
select md5('rsvp:' || r.handle || ':' || r.slug)::uuid, md5('user:' || r.handle)::uuid, md5('event:' || r.slug)::uuid, 'going'
from (values
  ('theo_code','repair-cafe'), ('noah_climbs','repair-cafe'), ('dario_legno','repair-cafe'), ('luna_dev','repair-cafe'), ('sam_mentor','repair-cafe'),
  ('tino_chef','bread-night'), ('priya_care','bread-night'), ('clara_books','bread-night'),
  ('sara_startup','founders-evening'), ('theo_code','founders-evening'), ('amara_textiles','founders-evening'), ('omar_bread','founders-evening'), ('luna_dev','founders-evening'),
  ('vera_erbe','rooftop-harvest'), ('omar_bread','rooftop-harvest'), ('ele_yoga','rooftop-harvest'), ('clara_books','rooftop-harvest'), ('bea_foto','rooftop-harvest'),
  ('ines_dance','mural-jam'), ('bea_foto','mural-jam'), ('jonas_sound','mural-jam'), ('nina_poeta','mural-jam'), ('sole_designer','mural-jam'), ('amara_textiles','mural-jam'),
  ('noah_climbs','yoga-alba'), ('priya_care','yoga-alba'), ('hana_garden','cena-condivisa'), ('jonas_sound','ascolto-disco'), ('zoe_murals','athanor-ottobre'),
  ('sam_mentor','athanor-ottobre'), ('ines_dance','athanor-ottobre'), ('leo_bikes','athanor-ottobre')
) as r(handle, slug)
on conflict do nothing;

insert into public.posts (id, author_id, category, type, body, is_step, tags, created_at)
select md5('post:' || p.handle || ':1')::uuid, md5('user:' || p.handle)::uuid,
       p.category::public.post_category, (case when p.image then 'image' else 'text' end)::public.post_type,
       p.body, p.is_step, p.tags, now() - (p.hours_ago || ' hours')::interval
from (values
  ('amara_textiles', 'creative',  'The two looms are home. Eighty years old, and they still sing when you work them.', true,  array['textiles'], true,  3),
  ('leo_bikes',      'human',     'First repair café: fourteen bikes in, eleven out on their own wheels. The other three need parts and a little love.', true, array['repair'], true, 5),
  ('hana_garden',    'evolution', 'The first harvest from the roof fed four families on the fifth floor. Next: the building across the street.', true, array['garden'], true, 8),
  ('omar_bread',     'business',  'Two apprentices signed today. Real contracts, real pay. They start on the night shift on Monday.', true, array['bakery'], true, 11),
  ('clara_books',    'creative',  'Forty-one recipes collected. The oldest one is from 1952 and it is mostly about patience.', true, array['books'], true, 14),
  ('zoe_murals',     'creative',  'The city said yes. Two hundred faces, one underpass, and a lot of paint.', true, array['murals'], true, 17),
  ('noah_climbs',    'human',     'Sunday wall, week three: nineteen kids. One of them topped the blue route and did not stop grinning for an hour.', true, array['climbing'], true, 20),
  ('jonas_sound',    'creative',  'Recorded the number 1 tram at five in the morning. The brakes sound like a cello.', true, array['sound'], true, 26),
  ('theo_code',      'evolution', 'Talked to five repair cafés. All five keep their inventory on paper. Starting the app tonight.', true, array['opensource'], false, 30),
  ('ines_dance',     'human',     'Rehearsal with nine neighbours tonight. Nobody knew the steps. Everybody knew when to laugh.', false, array['dance'], false, 34),
  ('priya_care',     'human',     'Three doctors said yes to the evening clinic. Now I need a room and someone who is good with rotas.', true, array['care'], false, 40),
  ('sam_mentor',     'business',  'Founder number ten this week. The question was the same as the first nine: "is it too late?" It never is.', true, array['mentoring'], false, 46)
) as p(handle, category, body, is_step, tags, image, hours_ago)
on conflict do nothing;

insert into public.post_media (id, post_id, kind, storage_path, position, width, height)
select md5('postmedia:' || h || ':0')::uuid, md5('post:' || h || ':1')::uuid, 'image'::public.media_kind,
       md5('user:' || h)::uuid::text || '/' || md5('post:' || h || ':1')::uuid::text || '/0.jpg', 0, 1080, 1350
from unnest(array['amara_textiles','leo_bikes','hana_garden','omar_bread','clara_books','zoe_murals','noah_climbs','jonas_sound']) as h
on conflict do nothing;

insert into public.post_comments (id, post_id, author_id, body)
select md5('comment:' || c.commenter || ':' || c.post_handle)::uuid,
       md5('post:' || c.post_handle || ':1')::uuid, md5('user:' || c.commenter)::uuid, c.body
from (values
  ('theo_code',     'leo_bikes',      'Eleven of fourteen is a great first day. I am building the inventory app for exactly this.'),
  ('omar_bread',    'hana_garden',    'Save me the basil. I will turn it into focaccia for the next harvest lunch.'),
  ('sam_mentor',    'omar_bread',     'Real contracts, real pay. That is the whole business plan, and it is a good one.'),
  ('nina_poeta',    'clara_books',    'A recipe that is mostly about patience sounds like a poem to me.'),
  ('bea_foto',      'zoe_murals',     'I will photograph the faces for you. Two hundred portraits, one a day.'),
  ('ele_yoga',      'noah_climbs',    'Grinning for an hour is the whole point.'),
  ('gio_musica',    'jonas_sound',    'Send me the cello tram. I want it on the record.'),
  ('priya_care',    'sam_mentor',     'Needed to read this today.'),
  ('clara_books',   'priya_care',     'The back room of my shop is free on Tuesdays and Thursdays.'),
  ('marta_ceramica','amara_textiles', 'Loom and kiln. We should open a studio together.')
) as c(commenter, post_handle, body)
on conflict do nothing;

insert into public.story_segments (id, author_id, kind, storage_path, duration_s, caption, is_step, pinned, expires_at)
select md5('story:' || s.handle || ':1')::uuid, md5('user:' || s.handle)::uuid, s.kind::public.story_kind,
       md5('user:' || s.handle)::uuid::text || '/' || md5('story:' || s.handle || ':1')::uuid::text
         || (case when s.kind = 'video' then '.mp4' else '.jpg' end),
       s.duration_s, s.caption, s.is_step, false, now() + interval '20 hours'
from (values
  ('ines_dance',  'video', 14,   'Rehearsal, take nine.',                     false),
  ('omar_bread',  'video', 12,   'Two in the morning. The dough decides.',    false),
  ('zoe_murals',  'video', 12,   'First colour on the underpass wall.',       true),
  ('noah_climbs', 'video', 12,   'Showing the kids the blue route.',          false),
  ('hana_garden', 'photo', null, 'This month''s harvest from the roof.',      true),
  ('leo_bikes',   'photo', null, 'The wall of wrenches, ready for Saturday.', false)
) as s(handle, kind, duration_s, caption, is_step)
on conflict do nothing;
-- Revive on a re-run: these six are outside refresh-staging.sql's frozen story list.
update public.story_segments set expires_at = now() + interval '20 hours', deleted_at = null
 where id in (select md5('story:' || h || ':1')::uuid
              from unnest(array['ines_dance','omar_bread','zoe_murals','noah_climbs','hana_garden','leo_bikes']) as h);

-- Connections and conversations. The long threads cross the ten-message line on purpose:
-- aura_award_momento_conversation pays both sides of a conversation that reaches it.
insert into public.connection_requests (id, requester_id, addressee_id, status, responded_at)
select md5('creq:' || c.a || ':' || c.b)::uuid, md5('user:' || c.a)::uuid, md5('user:' || c.b)::uuid,
       'accepted'::public.connection_status, now() - interval '3 days'
from (values ('leo_bikes','theo_code'), ('hana_garden','omar_bread'), ('priya_care','sam_mentor'), ('zoe_murals','ines_dance')) as c(a, b)
on conflict do nothing;

insert into public.connections (id, profile_a, profile_b, source_request_id)
select md5('conn:' || least(c.a, c.b) || ':' || greatest(c.a, c.b))::uuid,
       least(md5('user:' || c.a)::uuid, md5('user:' || c.b)::uuid),
       greatest(md5('user:' || c.a)::uuid, md5('user:' || c.b)::uuid),
       md5('creq:' || c.a || ':' || c.b)::uuid
from (values ('leo_bikes','theo_code'), ('hana_garden','omar_bread'), ('priya_care','sam_mentor'), ('zoe_murals','ines_dance')) as c(a, b)
on conflict do nothing;

insert into public.conversations (id, participant_a, participant_b, created_from)
select md5('conv:' || least(c.a, c.b) || ':' || greatest(c.a, c.b))::uuid,
       least(md5('user:' || c.a)::uuid, md5('user:' || c.b)::uuid),
       greatest(md5('user:' || c.a)::uuid, md5('user:' || c.b)::uuid),
       c.source::public.conversation_source
from (values ('leo_bikes','theo_code','momento'), ('hana_garden','omar_bread','momento'),
             ('priya_care','sam_mentor','direct'), ('zoe_murals','ines_dance','direct')) as c(a, b, source)
on conflict do nothing;

-- One message per row, in order: the momento trigger counts on every insert.
insert into public.messages (id, conversation_id, sender_id, kind, body, created_at)
select md5('msg:' || m.a || ':' || m.b || ':' || m.n)::uuid,
       md5('conv:' || least(m.a, m.b) || ':' || greatest(m.a, m.b))::uuid,
       md5('user:' || m.sender)::uuid, 'user'::public.message_kind, m.body,
       now() - ((m.hours_ago * 60 - m.n) || ' minutes')::interval
from (values
  ('sole_designer', 'luna_dev',   7, 'luna_dev',      'Thursday was great. Your portfolio is better than you think.', 2),
  ('sole_designer', 'luna_dev',   8, 'sole_designer', 'You are too kind. The site looks incredible, by the way.', 2),
  ('sole_designer', 'luna_dev',   9, 'luna_dev',      'Two clients already asked who built it.', 2),
  ('sole_designer', 'luna_dev',  10, 'sole_designer', 'Send them my way. And send me your sleep app, I want to try it.', 2),
  ('sole_designer', 'luna_dev',  11, 'luna_dev',      'Done. Tell me honestly if it keeps you up.', 2),
  ('leo_bikes', 'theo_code',  1, 'theo_code', 'Saw your dream. Five repair cafés, all on paper. Mine too?', 30),
  ('leo_bikes', 'theo_code',  2, 'leo_bikes', 'A notebook and a very tired volunteer. Why?', 30),
  ('leo_bikes', 'theo_code',  3, 'theo_code', 'I am building an app for exactly that. Can I watch a Saturday?', 30),
  ('leo_bikes', 'theo_code',  4, 'leo_bikes', 'Come at nine. Bring coffee, we have no budget.', 29),
  ('leo_bikes', 'theo_code',  5, 'theo_code', 'Deal. What is the worst part of the notebook?', 29),
  ('leo_bikes', 'theo_code',  6, 'leo_bikes', 'Nobody knows which parts we already have. We buy the same chain three times.', 29),
  ('leo_bikes', 'theo_code',  7, 'theo_code', 'That is a two-evening problem. I will have something by Friday.', 28),
  ('leo_bikes', 'theo_code',  8, 'leo_bikes', 'If it works, I will teach you to true a wheel.', 6),
  ('leo_bikes', 'theo_code',  9, 'theo_code', 'It works. Link is in your inbox.', 5),
  ('leo_bikes', 'theo_code', 10, 'leo_bikes', 'Three volunteers used it today without asking me anything. That never happens.', 4),
  ('leo_bikes', 'theo_code', 11, 'theo_code', 'Saturday, nine. I am bringing the coffee and my old bike.', 3),
  ('hana_garden', 'omar_bread',  1, 'omar_bread',  'Your roof tomatoes are the best I have had in Milan. Do you sell them?', 50),
  ('hana_garden', 'omar_bread',  2, 'hana_garden', 'Never. But I trade.', 50),
  ('hana_garden', 'omar_bread',  3, 'omar_bread',  'Bread for tomatoes?', 49),
  ('hana_garden', 'omar_bread',  4, 'hana_garden', 'Focaccia for tomatoes. And basil.', 49),
  ('hana_garden', 'omar_bread',  5, 'omar_bread',  'Done. Friday morning, still warm.', 49),
  ('hana_garden', 'omar_bread',  6, 'hana_garden', 'Come to the harvest lunch, the fifth floor wants to meet you.', 12),
  ('hana_garden', 'omar_bread',  7, 'omar_bread',  'I will bring two apprentices. They need to see where things grow.', 12),
  ('hana_garden', 'omar_bread',  8, 'hana_garden', 'Perfect. Gloves are on me.', 11),
  ('hana_garden', 'omar_bread',  9, 'omar_bread',  'See you on the roof.', 11),
  ('hana_garden', 'omar_bread', 10, 'hana_garden', 'Bring the focaccia.', 10),
  ('priya_care', 'sam_mentor', 1, 'sam_mentor', 'I read about the evening clinic. Who is paying for the room?', 20),
  ('priya_care', 'sam_mentor', 2, 'priya_care', 'Nobody yet. That is the problem.', 20),
  ('priya_care', 'sam_mentor', 3, 'sam_mentor', 'Then that is the first problem to solve. Coffee on Monday?', 19),
  ('priya_care', 'sam_mentor', 4, 'priya_care', 'Monday. Thank you, really.', 19),
  ('zoe_murals', 'ines_dance', 1, 'ines_dance', 'Could my neighbours dance in front of your mural on opening night?', 9),
  ('zoe_murals', 'ines_dance', 2, 'zoe_murals', 'Only if I get to paint one of them into it.', 9),
  ('zoe_murals', 'ines_dance', 3, 'ines_dance', 'Deal. Pick the one who laughs the loudest.', 8)
) as m(a, b, n, sender, body, hours_ago)
order by m.a, m.b, m.n
on conflict do nothing;

-- Momenti: fresh cards for today, so every new person has a deck and two pairs can match.
insert into public.momento_proposals (id, user_id, candidate_id, affinity, status, proposed_on, daily_rank)
select md5('momento:' || m.a || ':' || m.b)::uuid, md5('user:' || m.a)::uuid, md5('user:' || m.b)::uuid,
       m.affinity, 'pending'::public.momento_status, current_date, m.rank
from (values
  ('noah_climbs','ines_dance',2.0,1), ('ines_dance','noah_climbs',2.0,1),
  ('amara_textiles','marta_ceramica',2.0,1), ('clara_books','nina_poeta',2.0,1),
  ('jonas_sound','gio_musica',2.0,1), ('priya_care','ele_yoga',2.0,1),
  ('sam_mentor','sara_startup',2.0,1), ('zoe_murals','bea_foto',2.0,1),
  ('theo_code','luna_dev',2.0,1), ('omar_bread','tino_chef',2.0,1),
  ('hana_garden','vera_erbe',2.0,1), ('leo_bikes','dario_legno',2.0,1),
  ('noah_climbs','leo_bikes',2.0,2), ('amara_textiles','zoe_murals',2.0,2),
  ('clara_books','bea_foto',2.0,2), ('jonas_sound','rocco_film',2.0,2)
) as m(a, b, affinity, rank)
on conflict do nothing;

-- The ballot gets a crowd. cast_vote's weight trigger writes 1.000; one vote per voter per edition.
insert into public.candidacy_votes (id, edition_id, candidacy_id, voter_id)
select md5('vote:' || v.voter)::uuid, md5('fundedition:2027')::uuid,
       md5('candidacy:' || v.candidate)::uuid, md5('user:' || v.voter)::uuid
from (values
  ('noah_climbs','ele_yoga'), ('amara_textiles','marta_ceramica'), ('leo_bikes','marta_ceramica'),
  ('hana_garden','ele_yoga'), ('theo_code','marta_ceramica'), ('ines_dance','ele_yoga'),
  ('omar_bread','marta_ceramica'), ('clara_books','marta_ceramica'), ('jonas_sound','ele_yoga'),
  ('priya_care','ele_yoga'), ('sam_mentor','marta_ceramica'), ('zoe_murals','ele_yoga'),
  ('tino_chef','ele_yoga'), ('vera_erbe','marta_ceramica'), ('gio_musica','ele_yoga')
) as v(voter, candidate)
on conflict do nothing;

insert into public.athanor_days_interest (id, user_id, edition)
select md5('adi:' || a)::uuid, md5('user:' || a)::uuid, '2027'
from unnest(array['zoe_murals','sam_mentor','ines_dance','leo_bikes','hana_garden','priya_care']) as a
on conflict do nothing;

-- ---------------------------------------------------------------------------------
-- 4. Aura, earned through the app's own triggers
-- ---------------------------------------------------------------------------------
-- Invites activated: the newcomers joined through existing members' codes
-- (invites.code is the inviter's referral_code). Fires star_sweep_invite_activated.
insert into public.invites (id, inviter_id, code, invitee_id, activated_at)
select md5('invite:' || i.invitee)::uuid, md5('user:' || i.inviter)::uuid,
       upper(left(md5('ref:' || i.inviter), 8)), md5('user:' || i.invitee)::uuid,
       now() - interval '4 days'
from (values
  ('sole_designer','noah_climbs'), ('sole_designer','hana_garden'), ('marta_ceramica','amara_textiles'),
  ('dario_legno','leo_bikes'), ('luna_dev','theo_code'), ('ele_yoga','priya_care'),
  ('tino_chef','omar_bread'), ('nina_poeta','clara_books'), ('gio_musica','jonas_sound'),
  ('sara_startup','sam_mentor'), ('bea_foto','zoe_murals'), ('ele_yoga','ines_dance')
) as i(inviter, invitee)
on conflict do nothing;

-- A second round of help between people, so the community's Aura has a spread rather than a
-- floor: offered → accepted → completed, the member-facing path, which the guard allows.
insert into public.milestone_helps (id, milestone_id, helper_id, type, message, status)
select md5('help:' || h.helper || ':' || h.ms_handle || ':' || h.ms_pos)::uuid,
       md5('ms:' || h.ms_handle || ':' || h.ms_pos)::uuid, md5('user:' || h.helper)::uuid,
       h.type::public.help_type, h.message, 'accepted'::public.help_status
from (values
  ('sole_designer',  'zoe_murals',     1, 'skill',       'I will design the poster for the unveiling.'),
  ('sole_designer',  'clara_books',    1, 'skill',       'Let me set the type for the cover.'),
  ('luna_dev',       'theo_code',      1, 'skill',       'I will test it on my phone and break it for you.'),
  ('marta_ceramica', 'omar_bread',     1, 'connection',  'The kiln builder I used also builds bread ovens.'),
  ('gio_musica',     'jonas_sound',    1, 'skill',       'I will master the sound map so it plays well on phones.'),
  ('ele_yoga',       'ines_dance',     0, 'connection',  'Six people from my care-home class want to dance.'),
  ('tino_chef',      'clara_books',    0, 'connection',  'My grandmother''s risotto. And my aunt''s. And her neighbour''s.'),
  ('vera_erbe',      'hana_garden',    0, 'skill',       'I will show you which herbs keep the pests away.'),
  ('rocco_film',     'zoe_murals',     0, 'skill',       'I will film the underpass before and after for the city council.'),
  ('sara_startup',   'omar_bread',     0, 'skill',       'I will help you write the apprentice contracts.'),
  ('sara_startup',   'priya_care',     0, 'connection',  'Two doctors from my old company want to volunteer.'),
  ('dario_legno',    'noah_climbs',    0, 'skill',       'I will build the kids a practice board from reclaimed wood.'),
  ('nina_poeta',     'ines_dance',     1, 'skill',       'I will write the words the dancers speak between scenes.'),
  ('bea_foto',       'zoe_murals',     1, 'skill',       'Two hundred portraits. I already started.'),
  ('noah_climbs',    'leo_bikes',      0, 'skill',       'I will bring my tools and my cousins on Saturday.'),
  ('amara_textiles', 'ines_dance',     1, 'skill',       'I will weave the costumes.'),
  ('hana_garden',    'tino_chef',      0, 'connection',  'Your inn can have the rooftop''s herbs, every week.'),
  ('theo_code',      'luna_dev',       1, 'skill',       'I found why the app crashes on old phones. Pull request is open.'),
  ('ines_dance',     'ele_yoga',       0, 'skill',       'I will teach a movement class at the second care home.'),
  ('clara_books',    'nina_poeta',     0, 'opportunity', 'I will bind the first copy of your collection. On the house.'),
  ('jonas_sound',    'rocco_film',     1, 'skill',       'I have a recorder that makes no sound at all.'),
  ('priya_care',     'sam_mentor',     0, 'connection',  'Three nurses from my ward want to start something. Meet them.'),
  ('sam_mentor',     'amara_textiles', 1, 'opportunity', 'An old client has a mill room with north light. It is yours.'),
  ('zoe_murals',     'bea_foto',       0, 'opportunity', 'The mural committee wants to exhibit your workshop portraits.')
) as h(helper, ms_handle, ms_pos, type, message)
where exists (select 1 from public.dream_milestones m where m.id = md5('ms:' || h.ms_handle || ':' || h.ms_pos)::uuid)
on conflict do nothing;

update public.milestone_helps set status = 'completed'
 where id in (select md5('help:' || x.h)::uuid from (values
     ('sole_designer:zoe_murals:1'), ('sole_designer:clara_books:1'), ('luna_dev:theo_code:1'),
     ('marta_ceramica:omar_bread:1'), ('gio_musica:jonas_sound:1'), ('ele_yoga:ines_dance:0'),
     ('tino_chef:clara_books:0'), ('vera_erbe:hana_garden:0'), ('rocco_film:zoe_murals:0'),
     ('sara_startup:omar_bread:0'), ('sara_startup:priya_care:0'), ('dario_legno:noah_climbs:0'),
     ('nina_poeta:ines_dance:1'), ('bea_foto:zoe_murals:1'), ('noah_climbs:leo_bikes:0'),
     ('amara_textiles:ines_dance:1'), ('theo_code:luna_dev:1'), ('ines_dance:ele_yoga:0'),
     ('clara_books:nina_poeta:0'), ('jonas_sound:rocco_film:1'), ('priya_care:sam_mentor:0'),
     ('sam_mentor:amara_textiles:1')) as x(h))
   and status = 'accepted';

-- Stars on posts: each person stars a deterministic handful of other people's posts.
-- aura_award_post_starred pays the author, weighted by the reactor's own score.
insert into public.post_reactions (id, post_id, person_id)
select md5('reaction:' || r.handle || ':' || a.handle)::uuid, p.id, r.id
from public.posts p
join public.profiles a on a.id = p.author_id
cross join public.profiles r
where p.id = md5('post:' || a.handle || ':1')::uuid
  and r.id = md5('user:' || r.handle)::uuid
  and a.id = md5('user:' || a.handle)::uuid
  and r.id <> a.id
  and p.deleted_at is null
  and ('x' || left(md5(r.handle || '*' || a.handle), 2))::bit(8)::int % 3 = 0
on conflict do nothing;

commit;

select 'profiles' t, count(*) from public.profiles where id in (select id from auth.users where email like '%@staging.athanor.local')
union all select 'profiles in English', count(*) from public.profiles where locale = 'en' and id in (select id from auth.users where email like '%@staging.athanor.local')
union all select 'posts', count(*) from public.posts where deleted_at is null
union all select 'stories live', count(*) from public.story_segments where deleted_at is null and expires_at > now()
union all select 'events upcoming', count(*) from public.events where deleted_at is null and starts_at > now()
union all select 'conversations', count(*) from public.conversations
union all select 'messages', count(*) from public.messages
union all select 'votes', count(*) from public.candidacy_votes
union all select 'post stars', count(*) from public.post_reactions
union all select 'aura_events (engine-written, fills within a minute)', count(*) from public.aura_events
order by 1;
