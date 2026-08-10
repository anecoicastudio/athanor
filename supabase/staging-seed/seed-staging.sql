-- Athanor — STAGING world seed.
--
-- Not seed.sql. `supabase/seed.sql` is the two-user local-Docker seed wired to
-- `[db.seed]` in config.toml and is never run against a hosted project. This file is
-- the opposite: it only ever runs against the hosted STAGING project, to give a real
-- phone something to walk through — twelve people with dreams, milestones, events,
-- posts, conversations, a moderation queue and a fund edition.
--
-- HOW TO RUN — two gates, both required, see the guard below:
--     select vault.create_secret('staging', 'app.settings.environment');  -- once, staging only
--       (NOT `alter database … set` — a hosted project rejects that with 42501 for any
--        custom parameter, so the marker would silently never exist; see lines 70-74.)
--     set app.settings.seed_confirm = 'yes';                              -- every session, by hand
-- then run this file. See README.md.
--
-- IDEMPOTENT for the inserts. Every row carries a deterministic id derived from a
-- semantic key (`md5('post:' || handle || ':1')::uuid`), and every insert ends in a
-- bare `on conflict do nothing` — bare, not `(id)`, because most of these tables also
-- carry unique constraints on their natural key, and `on conflict (id)` would raise
-- on those instead of skipping. Editing a body and re-running will NOT update the
-- row; delete it first or bump the key.
--
-- ⚠ The `profiles` UPDATE in §1 is NOT idempotent in that sense: it unconditionally
-- rewrites handle/bio/locale/tags/visibility every run. Edit a seeded profile in the
-- app, re-seed, and your edit is gone.
--
-- ⚠ AURA. Rule 1 says only the score-engine writes `aura_events`/`aura_scores`, and
-- this file never touches them. But it is not Aura-neutral: §1 sets
-- `identity_verified = true` on the three fund-candidacy authors, and the M6 trigger
-- `profiles_aura_identity` awards **+50 each (150 total) for a verification that never
-- happened**. That is deliberate — `dream_candidacies_insert_own_verified` requires a
-- verified profile, so without it the candidacy flow cannot be walked from the app at
-- all — and it is disclosed here rather than hidden. Re-runs award nothing further
-- (the trigger tests false→true) and the engine dedupes on (profile_id, type, ref_id).
--
-- The other M6 triggers mostly do NOT fire on seeded data, so do not expect a
-- populated Aura tab: milestone/help awards are AFTER UPDATE and these rows are
-- inserted already-done; the ✦ award needs a reactor scoring >300; the momento award
-- needs ≥10 messages in a thread and the longest seeded one is 5. Aura from the rest
-- has to be earned in the app, which is the point of it.
--
-- WHAT THIS FILE DELIBERATELY DOES NOT SEED — paths where a hand-written row proves
-- nothing, so they must be walked for real:
--   aura_events / aura_scores  — rule 1, above.
--   stars                      — engine-only output derived from aura_events.
--   event_tickets, circle_memberships, fund_contributions, verifications,
--   stripe_webhook_events      — Stripe (test mode) is the source of truth.
--   event_attendance, event_live_stats — produced by the check-in edge function.
--   gdpr_export_jobs           — produced by the export job.
--   push_tokens                — needs a real device token from a real build.
--   post_media, and the files behind moments/story_segments — need real Storage
--                                objects; the rows point at paths that do not exist,
--                                so media will fail to load. Expected.
--
-- Side effect worth knowing: `notifications` DOES fill up, because
-- milestone_helps_notify_offer and connection_requests_notify_insert fire on the
-- inserts below. Those rows are real, not stale.

-- One transaction for the whole file. This is what makes the guard hold under
-- `psql -f`, where statements are otherwise sent in autocommit and a raise would be
-- printed and then happily ignored for every insert that follows. It also makes the
-- seed all-or-nothing, so a failure never leaves a half-built world.
begin;

-- ---------------------------------------------------------------------------------
-- GUARD — two independent gates, both required.
--
-- 1. The environment marker, read through `athanor.runtime_setting('environment')`:
--    the `app.settings.environment` GUC if one is set (a local stack can still do
--    that), else the Vault secret of that name. Staging carries the Vault secret;
--    production carries neither, so the resolver returns NULL there.
--    It is NOT read with current_setting directly: on a hosted project
--    `alter database … set` is rejected for every custom parameter (42501, supautils
--    allows only a fixed list), so a database-level `app.settings.environment` cannot
--    be created at all — the gate would be unpassable on staging and, worse, would
--    look like it was holding on production for a reason it never had.
-- 2. `app.settings.seed_confirm` must be set in THIS session, by the person running
--    the file. The marker in gate 1 travels with a dump, a PITR restore, or a clone —
--    Vault contents included — so if staging were ever restored into production, gate
--    1 alone would silently become true. Gate 2 cannot travel: it has to be typed.
-- ---------------------------------------------------------------------------------
do $$
begin
  if coalesce(athanor.runtime_setting('environment'), '') <> 'staging' then
    raise exception
      'REFUSING TO SEED: the environment marker is %, expected ''staging''. If this really is staging: select vault.create_secret(''staging'', ''app.settings.environment'');',
      coalesce(athanor.runtime_setting('environment'), '<unset>');
  end if;
  if coalesce(current_setting('app.settings.seed_confirm', true), '') <> 'yes' then
    raise exception
      'REFUSING TO SEED: run "set app.settings.seed_confirm = ''yes'';" in this session first. This gate exists because the environment marker survives a restore and could follow staging into production.';
  end if;
end $$;

-- ---------------------------------------------------------------------------------
-- 1. People. Twelve signable accounts, one password for all of them:
--
--        email: <handle>@staging.athanor.local     password: Athanor2026!
--
-- bcrypt-hashed rather than left unusable (as seed.sql does), because the app signs
-- in with signInWithPassword — an account you cannot log into is not a test account.
--
-- The four *_token columns are set to '' rather than left NULL on purpose: GoTrue
-- scans them into non-nullable Go strings, and a NULL there is the classic
-- "Database error querying schema" on a hand-inserted user.
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
  jsonb_build_object('locale', p.locale, 'display_name', p.display_name),
  now() - (p.age_days || ' days')::interval,
  now()
from (values
  ('sole_designer',    'Sole Marini',      'it', 40),
  ('luna_dev',         'Luna Ferrari',     'en', 38),
  ('marta_ceramica',   'Marta Bianchi',    'it', 35),
  ('gio_musica',       'Giovanni Russo',   'it', 33),
  ('ele_yoga',         'Elena Costa',      'it', 30),
  ('tino_chef',        'Valentino Greco',  'it', 28),
  ('vera_erbe',        'Vera Lombardi',    'en', 25),
  ('rocco_film',       'Rocco Esposito',   'it', 22),
  ('sara_startup',     'Sara Conti',       'en', 20),
  ('dario_legno',      'Dario Fontana',    'it', 17),
  ('nina_poeta',       'Nina Ricci',       'it', 12),
  ('bea_foto',         'Beatrice Sala',    'it',  8)
) as p(handle, display_name, locale, age_days)
on conflict do nothing;

-- Provider record. signInWithPassword resolves off auth.users alone, so login works
-- without this — but the account would show no provider anywhere, user.identities
-- would be [], and identity-linking paths would misbehave.
insert into auth.identities (id, provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
select md5('identity:' || u.email)::uuid, u.id::text, u.id,
       jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true),
       'email', null, u.created_at, u.created_at
from auth.users u
where u.email like '%@staging.athanor.local'
on conflict do nothing;

-- handle_new_user() created the profile rows on insert above; fill them in.
--
-- identity_tags / seeking MUST come from the curated vocabularies in
-- packages/core/src/onboarding/tags.ts — those keys are what the Momenti matcher
-- compares, and the UI renders them through t('tag.identity.<key>'), which has no
-- fallback: an off-list key renders as a blank chip and is silently dropped the
-- first time the profile is saved from the app.
--
-- referral_code mirrors ensure_referral_code()'s format (8 uppercase hex chars),
-- deterministically, so invites can reference it below.
update public.profiles pr set
  handle = p.handle,
  bio = p.bio,
  locale = p.locale,
  identity_tags = p.identity_tags,
  seeking = p.seeking,
  visibility = p.visibility,
  identity_verified = p.identity_verified,
  founding_member = p.founding_member,
  referral_code = upper(left(md5('ref:' || p.handle), 8))
from (values
  -- handle,          bio,                                                                            locale, identity_tags,                      seeking,                                 visibility,                                  verified, founding
  ('sole_designer',  'Designer. Studio piccolo, progetti che lasciano il mondo un po'' più chiaro.',  'it', array['creativo','freelance'],       array['collaborazioni','connessioni'], '{"bio":"public","dream":"public"}'::jsonb, false, true),
  ('luna_dev',       'Developer. Building things that help people sleep better.',                     'en', array['freelance','creativo'],       array['collaborazioni','crescita'],    '{"bio":"public","dream":"public"}'::jsonb, false, true),
  ('marta_ceramica', 'Ceramista. Tornio, smalti, e un forno che merita di essere acceso più spesso.', 'it', array['artista','freelance'],        array['business','connessioni'],       '{"bio":"public","dream":"public"}'::jsonb, true,  true),
  ('gio_musica',     'Produttore. Registro in una cantina con ottima acustica e pessimo wifi.',       'it', array['artista','creativo'],         array['collaborazioni','eventi'],      '{"bio":"public"}'::jsonb,                  false, false),
  ('ele_yoga',       'Insegnante di yoga. Porto la pratica dove di solito non arriva.',               'it', array['coach','freelance'],          array['connessioni','eventi'],         '{"bio":"public","dream":"public"}'::jsonb, true,  false),
  ('tino_chef',      'Cuoco. Cerco produttori che facciano le cose come si facevano.',                'it', array['imprenditore','creativo'],    array['business','collaborazioni'],    '{"bio":"public"}'::jsonb,                  false, false),
  -- vera_erbe is the one deliberately-private profile: the 'private' tier is the
  -- least-walked branch of athanor.field_visible (M10), and nothing else here covers it.
  ('vera_erbe',      'Herbalist. I pick, I dry, I listen.',                                           'en', array['artista','freelance'],        array['crescita','connessioni'],       '{"bio":"private","dream":"private"}'::jsonb, false, false),
  ('rocco_film',     'Filmmaker. Documentari corti su mestieri che stanno sparendo.',                 'it', array['artista','creativo'],         array['collaborazioni','crescita'],    '{"bio":"public","dream":"public"}'::jsonb, true,  false),
  ('sara_startup',   'Founder. Second time around, slower on purpose.',                               'en', array['imprenditore','investitore'], array['mentorship','business'],        '{"bio":"public"}'::jsonb,                  false, false),
  ('dario_legno',    'Falegname. Legno di recupero, giunti a vista, niente viti.',                    'it', array['artista','mentor'],           array['eventi','collaborazioni'],      '{"bio":"public","dream":"public"}'::jsonb, false, false),
  ('nina_poeta',     'Scrivo. Per lo più la sera, per lo più a mano.',                                'it', array['creativo','artista'],         array['crescita','connessioni'],       '{}'::jsonb,                                false, false),
  ('bea_foto',       'Fotografa. Ritratti lunghi, pellicola quando posso.',                           'it', array['freelance','artista'],        array['collaborazioni','eventi'],      '{"bio":"public","dream":"public"}'::jsonb, false, false)
) as p(handle, bio, locale, identity_tags, seeking, visibility, identity_verified, founding_member)
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
-- 2. Dreams + milestones. One active dream each (a partial unique index enforces
--    one active dream per profile). Six get milestones, so the dream detail screen
--    has something to render and the help flow has a target.
-- ---------------------------------------------------------------------------------
insert into public.dreams (id, profile_id, text, status)
select md5('dream:' || d.handle)::uuid, md5('user:' || d.handle)::uuid, d.text, 'active'
from (values
  ('sole_designer',  'Aprire uno studio che lavori solo su progetti in cui credo, e riuscire a camparci.'),
  ('luna_dev',       'Ship a sleep app that people actually keep on their phone after week two.'),
  ('marta_ceramica', 'Un forno mio, in un laboratorio con la luce giusta, aperto anche a chi vuole imparare.'),
  ('gio_musica',     'Produrre un disco intero senza uscire dalla mia regione.'),
  ('ele_yoga',       'Portare la pratica nelle case di riposo, una volta a settimana, gratis.'),
  ('tino_chef',      'Una locanda con otto coperti e un solo menù, quello del giorno.'),
  ('vera_erbe',      'A proper herbarium of the paths above the village. Printed, not a PDF.'),
  ('rocco_film',     'Filmare gli ultimi cinque maestri d''ascia rimasti sulla costa.'),
  ('sara_startup',   'Build a company that is still good to work at when it is forty people.'),
  ('dario_legno',    'Insegnare a dieci ragazzi a fare un giunto senza chiodi.'),
  ('nina_poeta',     'Finire la raccolta. Poi trovare qualcuno che la legga ad alta voce.'),
  ('bea_foto',       'Un ritratto di ogni bottega rimasta in centro, prima che chiudano.')
) as d(handle, text)
on conflict do nothing;

insert into public.dream_milestones (id, dream_id, body, status, position)
select md5('ms:' || m.handle || ':' || m.position)::uuid, md5('dream:' || m.handle)::uuid,
       m.body, m.status::public.milestone_status, m.position
from (values
  ('sole_designer',  0, 'Trovare lo spazio',                       'done'),
  ('sole_designer',  1, 'Primi tre clienti che pagano davvero',    'in_progress'),
  ('sole_designer',  2, 'Un socio che sappia fare i conti',        'open'),
  ('luna_dev',       0, 'Ship the beta to twenty people',          'done'),
  ('luna_dev',       1, 'Keep ten of them past week two',          'in_progress'),
  ('marta_ceramica', 0, 'Preventivo per il forno',                 'done'),
  ('marta_ceramica', 1, 'Capire dove metterlo',                    'in_progress'),
  ('gio_musica',     0, 'Trattare la stanza acusticamente',        'in_progress'),
  ('gio_musica',     1, 'Trovare un fonico paziente',              'open'),
  ('ele_yoga',       0, 'Parlare con la prima struttura',          'done'),
  ('ele_yoga',       1, 'Trovare due insegnanti che si alternino', 'open'),
  ('rocco_film',     0, 'Trovare il primo maestro d''ascia',       'done'),
  ('rocco_film',     1, 'Una camera che non faccia rumore',        'open')
) as m(handle, position, body, status)
on conflict do nothing;

-- Help offered on other people's milestones — the reciprocity loop, in three states.
-- These fire milestone_helps_notify_offer, so the recipients get real notifications.
insert into public.milestone_helps (id, milestone_id, helper_id, type, message, status)
select md5('help:' || h.helper || ':' || h.ms_handle || ':' || h.ms_pos)::uuid,
       md5('ms:' || h.ms_handle || ':' || h.ms_pos)::uuid,
       md5('user:' || h.helper)::uuid,
       h.type::public.help_type, h.message, h.status::public.help_status
from (values
  ('sara_startup', 'sole_designer',  1, 'skill',       'Ti do una mano coi preventivi, li ho fatti per due anni.', 'completed'),
  ('bea_foto',     'marta_ceramica', 1, 'connection',  'Conosco chi affitta il capannone dietro la stazione.',      'accepted'),
  ('gio_musica',   'rocco_film',     1, 'skill',       'Ho una camera silenziosa e un fonico paziente.',            'offered'),
  ('dario_legno',  'ele_yoga',       1, 'opportunity', 'Mia zia dirige una casa di riposo a dieci minuti.',         'offered')
) as h(helper, ms_handle, ms_pos, type, message, status)
on conflict do nothing;

-- need_milestone_id must point at a milestone that exists — only the six handles
-- above have any, so every target here is drawn from that set.
insert into public.favor_offers (id, actor_id, target_id, need, need_milestone_id)
select md5('favor:' || f.actor || ':' || f.target)::uuid,
       md5('user:' || f.actor)::uuid, md5('user:' || f.target)::uuid, f.need,
       md5('ms:' || f.target || ':' || f.ms_pos)::uuid
from (values
  ('tino_chef',   'ele_yoga',       1, 'Ti presento due strutture, ci lavoro col catering.'),
  ('nina_poeta',  'rocco_film',     1, 'Scrivo io la voce fuori campo, se ti serve.'),
  ('luna_dev',    'sole_designer',  1, 'Ti monto il sito in un pomeriggio.')
) as f(actor, target, ms_pos, need)
on conflict do nothing;

-- ---------------------------------------------------------------------------------
-- 3. Projects (Costellazioni) — one per category so every filter has a result.
-- ---------------------------------------------------------------------------------
insert into public.projects (id, author_id, title, category, description, terms, status)
select md5('project:' || p.handle || ':' || p.title)::uuid, md5('user:' || p.handle)::uuid,
       p.title, p.category::public.project_category, p.description, p.terms, p.status::public.project_status
from (values
  ('sara_startup',   'Cerco co-founder tecnico',          'startup',    'Prodotto già validato con venti utenti paganti. Serve qualcuno che sappia dire di no.', 'Equity, non stipendio. Parliamone.', 'open'),
  ('rocco_film',     'Documentario sui maestri d''ascia', 'artistic',   'Cinque episodi da dodici minuti. Ho già il primo protagonista.',                        'Compenso simbolico + credits.',      'open'),
  ('tino_chef',      'Locanda a otto coperti',            'business',   'Cerco chi abbia un locale sfitto in centro storico e voglia di rischiare.',              'Affitto a percentuale.',             'open'),
  ('vera_erbe',      'Mapping the paths',                 'volunteer',  'I need people who walk and photograph. Two Saturdays a month.',                         'No pay, just lunch.',                'open'),
  ('luna_dev',       'Sleep study, small n',              'scientific', 'Looking for someone with a research background to design the protocol properly.',        'Co-authorship.',                     'closed')
) as p(handle, title, category, description, terms, status)
on conflict do nothing;

-- ---------------------------------------------------------------------------------
-- 4. Events. `events_online_or_physical` requires geo on every non-online event, so
--    each physical one carries a real point — st_point takes (long, lat), matching
--    create_event(). currency is lowercase per its check (`^[a-z]{3}$`).
-- ---------------------------------------------------------------------------------
insert into public.events (id, organizer_id, title, category, is_online, venue, city, geo, stream_url,
                           starts_at, ends_at, capacity, price_cents, currency, is_kairos_day, is_athanor_day)
select md5('event:' || e.slug)::uuid, md5('user:' || e.handle)::uuid, e.title,
       e.category::public.event_category, e.is_online, e.venue, e.city,
       case when e.is_online then null
            else extensions.st_point(e.lng, e.lat)::extensions.geography end,
       e.stream_url,
       now() + (e.starts_in_days || ' days')::interval,
       now() + (e.starts_in_days || ' days')::interval + interval '2 hours',
       e.capacity, e.price_cents, 'eur', e.is_kairos, false
from (values
  ('cena-condivisa', 'tino_chef',     'Cena condivisa: si cucina insieme', 'creativi',   false, 'Cascina Bianca',       'Milano',  9.19, 45.46, null,                                    4, 12, 1500, false),
  ('yoga-alba',      'ele_yoga',      'Pratica all''alba, sul tetto',      'benessere',  false, 'Tetto di via Volta',   'Milano',  9.18, 45.48, null,                                    9, 20,    0, false),
  ('ascolto-disco',  'gio_musica',    'Ascolto guidato: il disco intero',  'musica',     true,  null,                   null,      null, null, 'https://example.invalid/live/ascolto',  16, 40,  800, false),
  ('kairos-ottobre', 'sole_designer', 'Kairos: il giorno che conta',       'evoluzione', false, 'Spazio Ostro',         'Milano',  9.20, 45.45, null,                                   25, 100,   0, true),
  -- negative offset = already over, so the "passati" state and the post-event review
  -- prompt both have something to act on.
  ('bottega-aperta', 'dario_legno',   'Bottega aperta: giunti a vista',    'formazione', false, 'Falegnameria Fontana', 'Bergamo', 9.67, 45.70, null,                                   -6, 10, 2000, false)
) as e(slug, handle, title, category, is_online, venue, city, lng, lat, stream_url, starts_in_days, capacity, price_cents, is_kairos)
on conflict do nothing;

insert into public.rsvps (id, user_id, event_id, status)
select md5('rsvp:' || r.handle || ':' || r.slug)::uuid, md5('user:' || r.handle)::uuid,
       md5('event:' || r.slug)::uuid, r.status
from (values
  ('sole_designer',  'cena-condivisa', 'going'),
  ('bea_foto',       'cena-condivisa', 'going'),
  ('nina_poeta',     'cena-condivisa', 'cancelled'),
  ('marta_ceramica', 'yoga-alba',      'going'),
  ('vera_erbe',      'yoga-alba',      'going'),
  ('luna_dev',       'ascolto-disco',  'going'),
  ('rocco_film',     'ascolto-disco',  'going'),
  ('sara_startup',   'kairos-ottobre', 'going'),
  ('tino_chef',      'bottega-aperta', 'going')
) as r(handle, slug, status)
on conflict do nothing;

-- ---------------------------------------------------------------------------------
-- 5. Feed: posts across all four categories, some marked as a step on a dream, plus
--    comments and reactions (counts are author-only per PRD §4.5 — that rule is about
--    who can SEE them, so seeding them is fine).
-- ---------------------------------------------------------------------------------
insert into public.posts (id, author_id, category, type, body, is_step, tags)
select md5('post:' || p.handle || ':' || p.n)::uuid, md5('user:' || p.handle)::uuid,
       p.category::public.post_category, 'text'::public.post_type, p.body, p.is_step, p.tags
from (values
  ('sole_designer',  1, 'business',  'Firmato per lo spazio. Tre stanze, una finestra che vale l''affitto.',           true,  array['studio']),
  ('marta_ceramica', 1, 'creative',  'Prima infornata nel forno nuovo. Due pezzi crepati, il terzo è quello giusto.',   true,  array['ceramica']),
  ('ele_yoga',       1, 'human',     'Oggi alla casa di riposo eravamo in sette. La settimana scorsa in due.',          true,  array['yoga']),
  ('rocco_film',     1, 'creative',  'Girato il primo. Ottantasei anni, sega a mano, non ha mai guardato in camera.',   true,  array['documentario']),
  ('luna_dev',       1, 'evolution', 'Week two retention: 11 of 20. Not great. Better than week one of the old build.', false, array['product']),
  ('sara_startup',   1, 'business',  'Said no to an investor today. First time it felt like the easy call.',           false, array['founder']),
  ('tino_chef',      1, 'human',     'Trovato il produttore di burro. Fa quaranta chili a settimana e basta.',          false, array['cucina']),
  ('vera_erbe',      1, 'creative',  'Dried the season''s first yarrow. Smells like hay and pepper.',                   false, array['herbs']),
  ('dario_legno',    1, 'human',     'Il primo giunto del ragazzo più giovane. Storto, ma tiene.',                      true,  array['legno']),
  ('nina_poeta',     1, 'creative',  'Tolte quaranta righe. La poesia è più corta e finalmente respira.',              false, array['scrittura']),
  ('bea_foto',       1, 'creative',  'La merceria di via Sant''Agnese chiude a dicembre. Fotografata ieri.',            false, array['ritratto']),
  ('gio_musica',     1, 'evolution', 'Trattata la stanza con dodici pannelli fatti in casa. Il riverbero è sparito.',   true,  array['audio'])
) as p(handle, n, category, body, is_step, tags)
on conflict do nothing;

insert into public.post_comments (id, post_id, author_id, body)
select md5('comment:' || c.commenter || ':' || c.post_handle)::uuid,
       md5('post:' || c.post_handle || ':1')::uuid, md5('user:' || c.commenter)::uuid, c.body
from (values
  ('bea_foto',      'marta_ceramica', 'Se ti va vengo a fotografare la prossima infornata.'),
  ('tino_chef',     'vera_erbe',      'L''achillea la useresti in cucina o solo in tisana?'),
  ('sara_startup',  'luna_dev',       'Eleven of twenty is a real number. Most people never look.'),
  ('nina_poeta',    'bea_foto',       'Ci scrivo qualcosa sopra, se la foto te la lasci guardare.'),
  ('sole_designer', 'dario_legno',    'Storto ma tiene è esattamente come è venuto il mio primo logo.')
) as c(commenter, post_handle, body)
on conflict do nothing;

insert into public.post_reactions (id, post_id, person_id)
select md5('reaction:' || r.reactor || ':' || r.post_handle)::uuid,
       md5('post:' || r.post_handle || ':1')::uuid, md5('user:' || r.reactor)::uuid
from (values
  ('luna_dev',       'sole_designer'),  ('bea_foto',      'sole_designer'),
  ('sole_designer',  'marta_ceramica'), ('vera_erbe',     'marta_ceramica'),
  ('nina_poeta',     'ele_yoga'),       ('dario_legno',   'ele_yoga'),
  ('gio_musica',     'rocco_film'),     ('sara_startup',  'luna_dev'),
  ('tino_chef',      'vera_erbe'),      ('marta_ceramica','dario_legno'),
  ('bea_foto',       'nina_poeta'),     ('rocco_film',    'gio_musica')
) as r(reactor, post_handle)
on conflict do nothing;

-- ---------------------------------------------------------------------------------
-- 6. Stories (24h segments) — expires_at in the future or they never render.
-- ---------------------------------------------------------------------------------
insert into public.story_segments (id, author_id, kind, storage_path, duration_s, caption, is_step, pinned, expires_at)
select md5('story:' || s.handle)::uuid, md5('user:' || s.handle)::uuid, 'photo'::public.story_kind,
       s.handle || '/stories/' || md5('story:' || s.handle) || '.jpg', null, s.caption, s.is_step, s.pinned,
       now() + interval '20 hours'
from (values
  ('marta_ceramica', 'Il forno acceso alle sei.',         true,  true),
  ('tino_chef',      'Burro, quaranta chili, tutto qui.', false, false),
  ('bea_foto',       'Ultimo giorno di luce buona.',      false, false),
  ('dario_legno',    'Il banco alle sette di mattina.',   true,  false)
) as s(handle, caption, is_step, pinned)
on conflict do nothing;

insert into public.story_reactions (id, segment_id, person_id)
select md5('storyreact:' || r.reactor || ':' || r.author)::uuid,
       md5('story:' || r.author)::uuid, md5('user:' || r.reactor)::uuid
from (values
  ('sole_designer', 'marta_ceramica'), ('bea_foto', 'marta_ceramica'),
  ('vera_erbe',     'tino_chef'),      ('nina_poeta', 'bea_foto')
) as r(reactor, author)
on conflict do nothing;

-- ---------------------------------------------------------------------------------
-- 7. Connections + conversations.
--    Both tables constrain the pair to canonical order (profile_a < profile_b,
--    participant_a < participant_b), so every pair goes through least/greatest —
--    including the id, which is derived from the ordered pair so a re-run with the
--    handles written the other way round still collides correctly.
--    These fire connection_requests_notify_insert → real notification rows.
-- ---------------------------------------------------------------------------------
insert into public.connection_requests (id, requester_id, addressee_id, status, responded_at)
select md5('creq:' || c.a || ':' || c.b)::uuid, md5('user:' || c.a)::uuid, md5('user:' || c.b)::uuid,
       c.status::public.connection_status,
       case when c.status = 'pending' then null else now() - interval '2 days' end
from (values
  ('sole_designer',  'luna_dev',    'accepted'),
  ('marta_ceramica', 'bea_foto',    'accepted'),
  ('rocco_film',     'gio_musica',  'accepted'),
  ('nina_poeta',     'sole_designer', 'pending'),
  ('sara_startup',   'tino_chef',   'pending'),
  ('vera_erbe',      'dario_legno', 'declined')
) as c(a, b, status)
on conflict do nothing;

insert into public.connections (id, profile_a, profile_b, source_request_id)
select md5('conn:' || least(c.a, c.b) || ':' || greatest(c.a, c.b))::uuid,
       least(md5('user:' || c.a)::uuid, md5('user:' || c.b)::uuid),
       greatest(md5('user:' || c.a)::uuid, md5('user:' || c.b)::uuid),
       md5('creq:' || c.a || ':' || c.b)::uuid
from (values
  ('sole_designer',  'luna_dev'),
  ('marta_ceramica', 'bea_foto'),
  ('rocco_film',     'gio_musica')
) as c(a, b)
on conflict do nothing;

-- last_message_at / last_message_preview are deliberately omitted: the
-- messages_bump_conversation trigger overwrites them from the last inserted message,
-- so seeding them would be dead weight.
insert into public.conversations (id, participant_a, participant_b, created_from)
select md5('conv:' || least(c.a, c.b) || ':' || greatest(c.a, c.b))::uuid,
       least(md5('user:' || c.a)::uuid, md5('user:' || c.b)::uuid),
       greatest(md5('user:' || c.a)::uuid, md5('user:' || c.b)::uuid),
       c.source::public.conversation_source
from (values
  ('sole_designer',  'luna_dev',   'momento'),
  ('marta_ceramica', 'bea_foto',   'direct'),
  ('rocco_film',     'gio_musica', 'momento')
) as c(a, b, source)
on conflict do nothing;

insert into public.messages (id, conversation_id, sender_id, kind, body, created_at)
select md5('msg:' || m.a || ':' || m.b || ':' || m.n)::uuid,
       md5('conv:' || least(m.a, m.b) || ':' || greatest(m.a, m.b))::uuid,
       md5('user:' || m.sender)::uuid, 'user'::public.message_kind, m.body,
       now() - ((10 - m.n) || ' hours')::interval
from (values
  ('sole_designer',  'luna_dev',   1, 'sole_designer',  'Ho visto il tuo dream. Il sito te lo faccio io, davvero.'),
  ('sole_designer',  'luna_dev',   2, 'luna_dev',       'Deal. What do you want in return?'),
  ('sole_designer',  'luna_dev',   3, 'sole_designer',  'Che mi dici la verità sul mio portfolio.'),
  ('sole_designer',  'luna_dev',   4, 'luna_dev',       'That is a worse deal for you. Thursday?'),
  ('sole_designer',  'luna_dev',   5, 'sole_designer',  'Allora ci vediamo giovedì.'),
  ('marta_ceramica', 'bea_foto',   1, 'bea_foto',       'Quando accendi il forno? Vorrei esserci.'),
  ('marta_ceramica', 'bea_foto',   2, 'marta_ceramica', 'Giovedì alle sei. È ancora buio, portati il cavalletto.'),
  ('marta_ceramica', 'bea_foto',   3, 'bea_foto',       'Porto la macchina grande.'),
  ('rocco_film',     'gio_musica', 1, 'gio_musica',     'Per il documentario: la cantina è insonorizzata adesso.'),
  ('rocco_film',     'gio_musica', 2, 'rocco_film',     'Quando posso venire a sentire?'),
  ('rocco_film',     'gio_musica', 3, 'gio_musica',     'La stanza è libera martedì.')
) as m(a, b, n, sender, body)
on conflict do nothing;

-- ---------------------------------------------------------------------------------
-- 8. Momenti. Reciprocal pending proposals so the deck has cards on first open, and
--    reciprocal ACCEPTED pairs — one-sided acceptance never reaches the mutual-match
--    state, which is the interesting one.
--
--    ⚠ momento_proposals_daily_cap is unique on (user_id, proposed_on, daily_rank):
--    if run_momenti_matcher() has already produced rows for these users today, the
--    bare `on conflict do nothing` is what stops this raising.
--    On a real run you can skip this block and use: select public.run_momenti_matcher();
-- ---------------------------------------------------------------------------------
insert into public.momento_proposals (id, user_id, candidate_id, reasons, affinity, status, proposed_on, daily_rank)
select md5('momento:' || m.a || ':' || m.b)::uuid,
       md5('user:' || m.a)::uuid, md5('user:' || m.b)::uuid, m.reasons, m.affinity,
       m.status::public.momento_status, current_date, m.rank
from (values
  ('sole_designer',  'gio_musica',    array['Cerchi: collaborazioni','Potrebbe cercare ciò che offri'], 2.0, 'pending',  1),
  ('gio_musica',     'sole_designer', array['Cerchi: collaborazioni','Potrebbe cercare ciò che offri'], 2.0, 'pending',  1),
  ('marta_ceramica', 'sara_startup',  array['Cerchi: business'],                                        1.0, 'pending',  2),
  ('ele_yoga',       'bea_foto',      array['Cerchi: eventi'],                                          1.0, 'pending',  1),
  ('bea_foto',       'nina_poeta',    array['Cerchi: collaborazioni'],                                  1.0, 'pending',  2),
  ('vera_erbe',      'nina_poeta',    array['You''re seeking: connessioni'],                            1.0, 'passed',   1),
  -- reciprocal accepted pairs → mutual match, and the two conversations in §7
  ('sole_designer',  'luna_dev',      array['Cerchi: collaborazioni'],                                  2.0, 'accepted', 2),
  ('luna_dev',       'sole_designer', array['You''re seeking: collaborazioni'],                         2.0, 'accepted', 1),
  ('rocco_film',     'gio_musica',    array['Cerchi: collaborazioni'],                                  2.0, 'accepted', 2),
  ('gio_musica',     'rocco_film',    array['Cerchi: eventi'],                                          2.0, 'accepted', 2)
) as m(a, b, reasons, affinity, status, rank)
on conflict do nothing;

-- ---------------------------------------------------------------------------------
-- 9. Moments (the 24h photo/video kind). Paths point nowhere — rows exist so the
--    grid and the waiting state render; the media itself will 404.
-- ---------------------------------------------------------------------------------
insert into public.moments (id, owner_id, kind, media_path, caption, width, height)
select md5('moment:' || m.handle)::uuid, md5('user:' || m.handle)::uuid, 'photo'::public.moment_kind,
       m.handle || '/moments/' || md5('moment:' || m.handle) || '.jpg', m.caption, 1080, 1350
from (values
  ('sole_designer',  'Le chiavi.'),
  ('marta_ceramica', 'Crepata, ma bella.'),
  ('tino_chef',      'Il burro giusto.'),
  ('rocco_film',     'Ottantasei anni.'),
  ('dario_legno',    'Tiene.')
) as m(handle, caption)
on conflict do nothing;

-- ---------------------------------------------------------------------------------
-- 10. Invites / referral. `invites.code` is a FK to profiles.referral_code, and
--     invitee_id is unique — the table is "one row per invitee who joined via a
--     code", so an invite with no invitee is not a thing. Only activations here.
-- ---------------------------------------------------------------------------------
insert into public.invites (id, inviter_id, code, invitee_id, activated_at)
select md5('invite:' || i.invitee)::uuid, md5('user:' || i.inviter)::uuid,
       upper(left(md5('ref:' || i.inviter), 8)), md5('user:' || i.invitee)::uuid,
       now() - interval '6 days'
from (values
  ('sole_designer', 'nina_poeta'),
  ('sole_designer', 'bea_foto'),
  ('ele_yoga',      'dario_legno')
) as i(inviter, invitee)
on conflict do nothing;

-- ---------------------------------------------------------------------------------
-- 11. Moderation. A queue for the admin panel, in three states, plus one block.
--     `reports.target_id` is untyped by design (it points at a person or a post).
-- ---------------------------------------------------------------------------------
insert into public.reports (id, reporter_id, target_type, target_id, category, note, status)
select md5('report:' || r.slug)::uuid, md5('user:' || r.reporter)::uuid, r.target_type, r.target_id,
       r.category, r.note, r.status
from (values
  ('sell-1',  'nina_poeta',  'post',     md5('post:sara_startup:1')::uuid, 'selling',    'Mi sembra che stia vendendo un corso nei commenti.',     'open'),
  ('mlm-1',   'vera_erbe',   'person',   md5('user:tino_chef')::uuid,      'mlm',        'Mi ha scritto in privato per un "sistema di guadagno".', 'open'),
  ('spam-1',  'dario_legno', 'post',     md5('post:gio_musica:1')::uuid,   'spam',       'Terzo post identico in due giorni.',                     'reviewing'),
  ('other-1', 'bea_foto',    'behavior', md5('user:rocco_film')::uuid,     'harassment', 'Insiste dopo che gli ho detto di no.',                   'upheld')
) as r(slug, reporter, target_type, target_id, category, note, status)
on conflict do nothing;

insert into public.blocks (id, blocker_id, blocked_id)
select md5('block:bea_foto:rocco_film')::uuid, md5('user:bea_foto')::uuid, md5('user:rocco_film')::uuid
on conflict do nothing;

-- ---------------------------------------------------------------------------------
-- 12. Fund edition + candidacies + votes.
--     phase = 'community' — both because 'candidacy' is not a legal phase, and
--     because cast_vote() requires 'community', which is what makes voting walkable.
--     `candidacy_votes.weight` is NOT supplied: set_candidacy_vote_weight() is a
--     BEFORE INSERT trigger that raises 'weight is server-written' for any non-zero
--     value, service_role included. It snapshots aura_scores — zero here, honestly.
--     Candidacy authors are exactly the identity_verified accounts from §1, so the
--     create/edit flow is actually walkable from the app.
--     Contributions are NOT seeded — those are Stripe's to create, in test mode.
-- ---------------------------------------------------------------------------------
insert into public.fund_editions (id, year, target_at, goal_cents, phase, candidacy_window_open, contributions_enabled)
values (md5('fundedition:2027')::uuid, 2027,
        (date_trunc('year', now()) + interval '1 year' + interval '5 months')::timestamptz,
        5000000, 'community', true, true)
on conflict do nothing;

insert into public.dream_candidacies (id, edition_id, profile_id, story, goal, impact, video_url, plan, status, city, category)
select md5('candidacy:' || c.handle)::uuid, md5('fundedition:2027')::uuid, md5('user:' || c.handle)::uuid,
       c.story, c.goal, c.impact, 'https://example.invalid/video/' || c.handle, c.plan, c.status, c.city, c.category
from (values
  ('marta_ceramica', 'Faccio ceramica da undici anni in uno studio in affitto che devo lasciare.', 'Un forno mio e un laboratorio aperto a chi vuole imparare.', 'Otto corsi l''anno, gratuiti per chi non può pagarli.', 'Forno usato, impianto elettrico, sei mesi di affitto.',  'shortlisted', 'Milano', 'craft'),
  ('ele_yoga',       'Insegno yoga da sei anni. Da due lo porto in una casa di riposo, gratis.',    'Arrivare a cinque strutture, con insegnanti pagati.',        'Duecento persone che non uscirebbero di casa.',         'Formazione di quattro insegnanti, un anno di compensi.', 'submitted',   'Milano', 'wellbeing'),
  ('rocco_film',     'Filmo mestieri che stanno sparendo. Ne restano cinque sulla costa.',          'Cinque episodi finiti e distribuiti.',                       'Un archivio di cose che tra dieci anni non ci sono più.','Attrezzatura, viaggi, montaggio.',                       'submitted',   'Genova', 'artistic')
) as c(handle, story, goal, impact, plan, status, city, category)
on conflict do nothing;

-- One vote per (edition, voter) — the unique constraint, and the rule.
insert into public.candidacy_votes (id, edition_id, candidacy_id, voter_id)
select md5('vote:' || v.voter)::uuid, md5('fundedition:2027')::uuid,
       md5('candidacy:' || v.candidate)::uuid, md5('user:' || v.voter)::uuid
from (values
  ('sole_designer', 'marta_ceramica'),
  ('bea_foto',      'marta_ceramica'),
  ('dario_legno',   'marta_ceramica'),
  ('luna_dev',      'ele_yoga'),
  ('sara_startup',  'ele_yoga'),
  ('nina_poeta',    'rocco_film')
) as v(voter, candidate)
on conflict do nothing;

insert into public.athanor_days_interest (id, user_id, edition)
select md5('adi:' || a.handle)::uuid, md5('user:' || a.handle)::uuid, '2027'
from (values ('sole_designer'), ('ele_yoga'), ('tino_chef'), ('bea_foto')) as a(handle)
on conflict do nothing;

-- ---------------------------------------------------------------------------------
-- 13. remote_config — boot kill-switches.
--
-- ⚠ DELIBERATELY DIVERGES FROM PRODUCTION. The runbook sets
-- fund_contributions_enabled and prime_stelle_enabled to false on production, and
-- fund_editions.contributions_enabled carries a "LEGAL FLAG: gated until counsel
-- clears" comment. They are true here so the flows can be walked in Stripe test mode.
-- Do not copy this block to production.
-- ---------------------------------------------------------------------------------
insert into public.remote_config (key, value) values
  ('min_app_version',           '{"ios":"1.0.0","android":"1.0.0"}'::jsonb),
  ('maintenance_mode',          '{"enabled":false,"eta":null}'::jsonb),
  ('fund_contributions_enabled','{"enabled":true}'::jsonb),
  ('prime_stelle_enabled',      '{"enabled":true}'::jsonb)
on conflict do nothing;

commit;

-- ---------------------------------------------------------------------------------
-- Summary — read this after running. `aura_events` is engine-written: expect 3
-- (the disclosed identity_verified awards), and only if the score-engine and its
-- GUCs are deployed. `stars` is engine-only and should be 0 here.
-- ---------------------------------------------------------------------------------
select 'profiles' as t, count(*) from public.profiles
union all select 'dreams', count(*) from public.dreams
union all select 'milestones', count(*) from public.dream_milestones
union all select 'helps', count(*) from public.milestone_helps
union all select 'favor_offers', count(*) from public.favor_offers
union all select 'projects', count(*) from public.projects
union all select 'events', count(*) from public.events
union all select 'rsvps', count(*) from public.rsvps
union all select 'posts', count(*) from public.posts
union all select 'comments', count(*) from public.post_comments
union all select 'reactions', count(*) from public.post_reactions
union all select 'stories', count(*) from public.story_segments
union all select 'connections', count(*) from public.connections
union all select 'conversations', count(*) from public.conversations
union all select 'messages', count(*) from public.messages
union all select 'momento_proposals', count(*) from public.momento_proposals
union all select 'moments', count(*) from public.moments
union all select 'invites', count(*) from public.invites
union all select 'reports', count(*) from public.reports
union all select 'candidacies', count(*) from public.dream_candidacies
union all select 'votes', count(*) from public.candidacy_votes
union all select 'notifications (trigger-written)', count(*) from public.notifications
union all select 'aura_events (engine-written)', count(*) from public.aura_events
union all select 'stars (engine-only, expect 0)', count(*) from public.stars
order by 1;
