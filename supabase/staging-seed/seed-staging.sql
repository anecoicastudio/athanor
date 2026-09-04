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
-- `identity_verified = true` on SIX profiles, and the M6 trigger
-- `profiles_aura_identity` awards **+50 each (300 total) for a verification that never
-- happened**. That is deliberate in both halves, and disclosed here rather than hidden:
--   • the three fund-candidacy authors (marta_ceramica, ele_yoga, rocco_film), because
--     `dream_candidacies_insert_own_verified` requires a verified profile — without it
--     the candidacy flow cannot be walked from the app at all;
--   • the three paid-event organisers (tino_chef, gio_musica, dario_legno), because
--     #448's `events_enforce_paid_gate` refuses a paid event whose organiser is not
--     verified. A paid event by an unverified organiser is a row that can no longer
--     exist, so seeding one would model an impossible world rather than a fake one.
-- Re-runs award nothing further (the trigger tests false→true) and the engine dedupes
-- on (profile_id, type, ref_id).
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
--   event_attendance           — produced by the check-in edge function.
--   event_live_stats           — produced by the live_window_sweep() cron (#120), never
--                                by check-in (this file's old claim). Listener count is
--                                Realtime presence, not a row.
--   gdpr_export_jobs           — produced by the export job.
--   push_tokens                — needs a real device token from a real build.
--
-- MEDIA. This file writes the descriptor rows and the storage KEYS; it cannot write
-- bytes. Run `supabase/staging-seed/transcode-media.sh` and then
-- `pnpm staging:media --confirm` after seeding — the upload script reads the keys back
-- out of these tables and puts a file at each one, so the two can never drift.
-- Until it runs, every image and video is a blank rectangle.
--
-- COMPANION: refresh-staging.sql installs the hourly `staging_refresh_world()` cron
-- that keeps this world restored while it is being tested. It carries frozen copies
-- of the semantic-key lists below (stories, events, statuses, content ids) and of §12's
-- ballot-window offsets — editing one of those sections here means re-running
-- refresh-staging.sql afterwards.
--
-- The keys are `{uid}/{id}.{ext}` — the same shape the app itself uploads at
-- (apps/native/src/lib/media/paths.ts), and NOT the `<handle>/stories/<md5>.jpg` this
-- file used to write. That older shape could never have worked: since
-- 20260808151808_storage_not_blocked_predicate.sql every private bucket's SELECT policy
-- requires the first path segment to match a dashed-uuid regex before it casts it, and
-- a handle fails that regex. Bytes uploaded at the old keys were unreadable by every
-- client, service-role reads notwithstanding — which is exactly why nobody noticed for
-- three months: no byte was ever fetched.
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
--
-- display_name is re-derived from auth.users rather than listed again below: handle_new_user
-- already copied it across on insert, and re-reading the same source keeps the two in step if
-- this file is re-run over profiles someone has since edited in the app.
--
-- avatar_path is set for EIGHT of the twelve. That is the point, not a shortfall: name and
-- photo are optional (#75), so a world where every member has a face would never render the
-- initials fallback that four-twelfths of real members will have. The four without —
-- sara_startup, dario_legno, nina_poeta, bea_foto — are the control group. Key shape is
-- {uid}/{uid}.jpg, matching the migration's documented convention; the upload script reads
-- this column back rather than recomputing it.
update public.profiles pr set
  handle = p.handle,
  bio = p.bio,
  locale = p.locale,
  identity_tags = p.identity_tags,
  seeking = p.seeking,
  visibility = p.visibility,
  identity_verified = p.identity_verified,
  founding_member = p.founding_member,
  referral_code = upper(left(md5('ref:' || p.handle), 8)),
  display_name = athanor.normalize_display_name(
    (select u.raw_user_meta_data ->> 'display_name' from auth.users u where u.id = pr.id)
  ),
  avatar_path = case
    when p.handle in ('sole_designer', 'luna_dev', 'marta_ceramica', 'gio_musica',
                      'ele_yoga', 'tino_chef', 'vera_erbe', 'rocco_film')
      then md5('user:' || p.handle)::uuid::text || '/' || md5('user:' || p.handle)::uuid::text || '.jpg'
    else null
  end
from (values
  -- handle,          bio,                                                                            locale, identity_tags,                      seeking,                                 visibility,                                  verified, founding
  ('sole_designer',  'Designer. Studio piccolo, progetti che lasciano il mondo un po'' più chiaro.',  'it', array['creativo','freelance'],       array['collaborazioni','connessioni'], '{"bio":"public","dream":"public"}'::jsonb, false, true),
  ('luna_dev',       'Developer. Building things that help people sleep better.',                     'en', array['freelance','creativo'],       array['collaborazioni','crescita'],    '{"bio":"public","dream":"public"}'::jsonb, false, true),
  ('marta_ceramica', 'Ceramista. Tornio, smalti, e un forno che merita di essere acceso più spesso.', 'it', array['artista','freelance'],        array['business','connessioni'],       '{"bio":"public","dream":"public"}'::jsonb, true,  true),
  ('gio_musica',     'Produttore. Registro in una cantina con ottima acustica e pessimo wifi.',       'it', array['artista','creativo'],         array['collaborazioni','eventi'],      '{"bio":"public"}'::jsonb,                  true,  false),
  ('ele_yoga',       'Insegnante di yoga. Porto la pratica dove di solito non arriva.',               'it', array['coach','freelance'],          array['connessioni','eventi'],         '{"bio":"public","dream":"public"}'::jsonb, true,  false),
  ('tino_chef',      'Cuoco. Cerco produttori che facciano le cose come si facevano.',                'it', array['imprenditore','creativo'],    array['business','collaborazioni'],    '{"bio":"public"}'::jsonb,                  true,  false),
  -- vera_erbe is the one deliberately-private profile: the 'private' tier is the
  -- least-walked branch of athanor.field_visible (M10), and nothing else here covers it.
  ('vera_erbe',      'Herbalist. I pick, I dry, I listen.',                                           'en', array['artista','freelance'],        array['crescita','connessioni'],       '{"bio":"private","dream":"private"}'::jsonb, false, false),
  ('rocco_film',     'Filmmaker. Documentari corti su mestieri che stanno sparendo.',                 'it', array['artista','creativo'],         array['collaborazioni','crescita'],    '{"bio":"public","dream":"public"}'::jsonb, true,  false),
  ('sara_startup',   'Founder. Second time around, slower on purpose.',                               'en', array['imprenditore','investitore'], array['mentorship','business'],        '{"bio":"public"}'::jsonb,                  false, false),
  ('dario_legno',    'Falegname. Legno di recupero, giunti a vista, niente viti.',                    'it', array['artista','mentor'],           array['eventi','collaborazioni'],      '{"bio":"public","dream":"public"}'::jsonb, true,  false),
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
  -- #227: marta_ceramica is a CANDIDATE whose candidacy links this dream, so her ballot card
  -- reads its confirmed history. Without a completed help here the card could only ever show
  -- «Aiuti confermati · 0» and the half of the block that proves the DEFINER aggregate works
  -- would be untestable by eye on staging. On milestone 0 (the done one), so the two numbers
  -- describe the same finished piece of work.
  ('dario_legno',  'marta_ceramica', 0, 'skill',       'Ti aiuto a montare l''impianto, l''ho fatto nel mio laboratorio.', 'completed'),
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
--
--    settlement_ack_at is stamped on the paid rows and left null on the free ones,
--    mirroring create_event exactly. #448's events_enforce_paid_gate is a BEFORE INSERT
--    trigger, so it fires here too — this file writes as the owner, not through the RPC,
--    and a trigger does not care which. Together with the three organisers verified in
--    §1, that is what keeps the three paid events insertable at all.
-- ---------------------------------------------------------------------------------
insert into public.events (id, organizer_id, title, category, is_online, venue, city, geo, stream_url,
                           starts_at, ends_at, capacity, price_cents, currency, is_athanor_day,
                           settlement_ack_at)
select md5('event:' || e.slug)::uuid, md5('user:' || e.handle)::uuid, e.title,
       e.category::public.event_category, e.is_online, e.venue, e.city,
       case when e.is_online then null
            else extensions.st_point(e.lng, e.lat)::extensions.geography end,
       e.stream_url,
       now() + (e.starts_in_days || ' days')::interval,
       now() + (e.starts_in_days || ' days')::interval + interval '2 hours',
       e.capacity, e.price_cents, 'eur', e.is_athanor,
       case when e.price_cents > 0 then now() else null end
from (values
  ('cena-condivisa', 'tino_chef',     'Cena condivisa: si cucina insieme', 'creativi',   false, 'Cascina Bianca',       'Milano',  9.19, 45.46, null,                                    4, 12, 1500, false),
  ('yoga-alba',      'ele_yoga',      'Pratica all''alba, sul tetto',      'benessere',  false, 'Tetto di via Volta',   'Milano',  9.18, 45.48, null,                                    9, 20,    0, false),
  ('ascolto-disco',  'gio_musica',    'Ascolto guidato: il disco intero',  'musica',     true,  null,                   null,      null, null, 'https://example.invalid/live/ascolto',  16, 40,  800, false),
  ('athanor-ottobre', 'sole_designer', 'Athanor Day: il giorno che conta',  'evoluzione', false, 'Spazio Ostro',         'Milano',  9.20, 45.45, null,                                   25, 100,   0, true),
  -- negative offset = already over, so the "passati" state and the post-event review
  -- prompt both have something to act on.
  ('bottega-aperta', 'dario_legno',   'Bottega aperta: giunti a vista',    'formazione', false, 'Falegnameria Fontana', 'Bergamo', 9.67, 45.70, null,                                   -6, 10, 2000, false)
) as e(slug, handle, title, category, is_online, venue, city, lng, lat, stream_url, starts_in_days, capacity, price_cents, is_athanor)
on conflict do nothing;

-- #126 fixture: events sitting INSIDE the reminder windows. Every offset above is
-- measured in days, and every reminder window is sub-daily — 24h for any event, 1h for an
-- online one and 1h for every organiser (#522) — so without these the every-minute
-- event_reminder_sweep has nothing to find and the reminder stays invisible on staging no
-- matter how correct the producer is.
-- 'promemoria-oggi' is physical and 5h out, so it claims t24 and (correctly) never a t1;
-- 'diretta-tra-poco' is online and 30m out, so it claims t1 ONLY — the t24 floor is what
-- stops one person getting two identical reminders on the same tick.
-- 'bottega-tra-poco' (#624) is the #617 collision shape, mirrored from pgTAP 0130's E7:
-- physical, 40 minutes out, and its organiser holds a going RSVP of their own (see §4's
-- rsvps). Before PR #622 that organiser claimed t24 AND org_t1 on one tick — two pushes
-- about one event, seconds apart. Now they get org_t1 alone («Il tuo evento comincia tra
-- un'ora», no head-count) while the ordinary attendee, whose t24 floor is still zero on a
-- room, gets «è tra poco. 2 partecipano». Sign in as dario_legno within the hour after a
-- refresh and the notification centre must hold exactly ONE reminder for it.
-- refresh-staging.sql §10b re-stamps all three hourly and clears their markers, so each
-- reminder fires again. Noise, chosen on purpose: the hourly re-arm costs one org_t1 row
-- for dario_legno and one t24 row for tino_chef per hour — in-app rows only, because no
-- persona holds a push token unless a tester registered one on a device while signed in
-- as them — and §13 of the refresh prunes eventReminder rows older than 2h, so a centre
-- never holds more than two of them. That is the same budget diretta-tra-poco already
-- spends on gio_musica, luna_dev and rocco_film; nothing is muted, because the thing the
-- walk observes is the count of rows, and a muted preference would suppress the push
-- without touching the row anyway.
insert into public.events (id, organizer_id, title, category, is_online, venue, city, geo, stream_url,
                           starts_at, ends_at, capacity, price_cents, currency, is_athanor_day)
select md5('event:' || e.slug)::uuid, md5('user:' || e.handle)::uuid, e.title,
       e.category::public.event_category, e.is_online, e.venue, e.city,
       case when e.is_online then null
            else extensions.st_point(e.lng, e.lat)::extensions.geography end,
       e.stream_url,
       now() + e.starts_in, now() + e.starts_in + interval '2 hours',
       e.capacity, 0, 'eur', false
from (values
  ('promemoria-oggi',  'ele_yoga',   'Promemoria: il cerchio di stasera', 'benessere', false,
   'Sala Grande', 'Milano', 9.19, 45.46, null,                                     interval '5 hours',   30),
  ('diretta-tra-poco', 'gio_musica', 'Diretta: si comincia tra poco',     'musica',    true,
   null,          null,     null, null,  'https://example.invalid/live/tra-poco',  interval '30 minutes', 60),
  ('bottega-tra-poco', 'dario_legno', 'Apertura bottega: si comincia tra poco', 'formazione', false,
   'Falegnameria Fontana', 'Bergamo', 9.67, 45.70, null,                          interval '40 minutes', 10)
) as e(slug, handle, title, category, is_online, venue, city, lng, lat, stream_url, starts_in, capacity)
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
  ('sara_startup',   'athanor-ottobre', 'going'),
  ('tino_chef',      'bottega-aperta', 'going'),
  -- #126: attendees for the two reminder-window events. The cancelled seat on
  -- promemoria-oggi is load-bearing — «N partecipano» counts going RSVPs only, so it is
  -- what proves the count is not just `count(*)` over the table.
  ('sole_designer',  'promemoria-oggi',  'going'),
  ('bea_foto',       'promemoria-oggi',  'going'),
  ('nina_poeta',     'promemoria-oggi',  'cancelled'),
  ('luna_dev',       'diretta-tra-poco', 'going'),
  ('rocco_film',     'diretta-tra-poco', 'going'),
  -- #624: the organiser's OWN going row on their physical event — the half of the #617
  -- shape that no other seeded event has. RsvpBar renders with no isOrganizer gate, so this
  -- is one tap in the app; here it is the row that makes the t24 arm see the organiser.
  -- tino_chef is the contrast case: an ordinary attendee of a room keeps the zero floor.
  ('dario_legno',    'bottega-tra-poco', 'going'),
  ('tino_chef',      'bottega-tra-poco', 'going')
) as r(handle, slug, status)
on conflict do nothing;

-- ---------------------------------------------------------------------------------
-- 5. Feed: posts across all four categories, some marked as a step on a dream, plus
--    comments and reactions (counts are author-only per PRD §4.5 — that rule is about
--    who can SEE them, so seeding them is fine).
-- ---------------------------------------------------------------------------------
-- `type` is not a label — PostMedia.tsx short-circuits on `postType === 'text'` and renders
-- nothing, so a post carrying a post_media row but left at 'text' shows no image at all. The
-- four handles below must match the post_media block that follows exactly.
insert into public.posts (id, author_id, category, type, body, is_step, tags)
select md5('post:' || p.handle || ':' || p.n)::uuid, md5('user:' || p.handle)::uuid,
       p.category::public.post_category,
       (case when p.handle in ('bea_foto', 'ele_yoga', 'vera_erbe', 'nina_poeta')
             then 'image' else 'text' end)::public.post_type,
       p.body, p.is_step, p.tags
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

-- Media on four of the twelve posts, so the feed is not a wall of text cards. Eight stay text
-- on purpose: a text-only post is the common case and its layout has to keep working.
--
-- Key shape {uid}/{post_id}/{position}.jpg — postMediaPath() in
-- apps/native/src/lib/media/paths.ts, and the only shape the bucket's SELECT policy can read.
-- width/height are the transcode's card crop (transcode-media.sh, CARD_VF); they must match the
-- file or the feed reserves a differently-shaped box and the image jumps on load.
insert into public.post_media (id, post_id, kind, storage_path, position, width, height)
select md5('postmedia:' || m.handle || ':0')::uuid,
       md5('post:' || m.handle || ':1')::uuid,
       'image'::public.media_kind,
       md5('user:' || m.handle)::uuid::text || '/' || md5('post:' || m.handle || ':1')::uuid::text || '/0.jpg',
       0, 1080, 1350
from (values
  -- bea_foto's post is «La merceria di via Sant'Agnese chiude a dicembre. Fotografata ieri.»
  -- and the file behind it is an elderly tailor at a sewing machine — the closest caption/photo
  -- pair in the supplied set.
  ('bea_foto'), ('ele_yoga'), ('vera_erbe'), ('nina_poeta')
) as m(handle)
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
-- Nine segments over eight handles. dario_legno carries two, so the viewer's segment advance
-- and a photo→video transition inside one rail both get walked; everyone else has one, which is
-- the common shape. Four are video, because a photo story and a video story fail differently
-- (StoriesViewer renders a ▶ glyph for one and nothing at all for the other) and a rail of
-- photos would hide that.
--
-- duration_s is the REAL length of the transcoded file, rounded down. The column is
-- `check (duration_s between 0 and 60)` and the viewer paces its progress bar off it, so a
-- guessed value desynchronises the bar from the video.
insert into public.story_segments (id, author_id, kind, storage_path, duration_s, caption, is_step, pinned, expires_at)
select md5('story:' || s.handle || ':' || s.n)::uuid, md5('user:' || s.handle)::uuid,
       s.kind::public.story_kind,
       md5('user:' || s.handle)::uuid::text || '/' || md5('story:' || s.handle || ':' || s.n)::uuid::text
         || (case when s.kind = 'video' then '.mp4' else '.jpg' end),
       s.duration_s, s.caption, s.is_step, s.pinned,
       now() + interval '20 hours'
from (values
  -- handle,         n, kind,    dur,  caption,                                              step,  pinned
  ('marta_ceramica', 1, 'video', 16,   'Il forno acceso alle sei.',                          true,  true),
  ('tino_chef',      1, 'photo', null, 'Burro, quaranta chili, tutto qui.',                  false, false),
  ('bea_foto',       1, 'photo', null, 'Ultimo giorno di luce buona.',                       false, false),
  ('dario_legno',    1, 'photo', null, 'Il banco alle sette di mattina.',                    true,  false),
  ('dario_legno',    2, 'video', 8,    'Il ragazzo ha finito il suo primo giunto.',          false, false),
  ('ele_yoga',       1, 'photo', null, 'Verticale sul molo. Tre respiri, poi giù.',          false, false),
  -- vera_erbe writes in English: her profile is the 'en' locale one.
  ('vera_erbe',      1, 'photo', null, 'This one dries in four days. The smell comes later.', false, false),
  ('gio_musica',     1, 'video', 12,   'La cantina alle undici di sera.',                    true,  false),
  ('sole_designer',  1, 'video', 10,   'Primo sopralluogo. Misuro tutto due volte.',         false, false)
) as s(handle, n, kind, duration_s, caption, is_step, pinned)
on conflict do nothing;

-- Revive the rail on a re-run. Without this the seed is a no-op the second time
-- (`on conflict do nothing`) while `prune_expired_story_segments` has already soft-deleted
-- everything unpinned — so a re-seeded world would come back with exactly one story, and the
-- storage SELECT policy would hide the bytes of the rest too
-- (20260809151111: `deleted_at is null and (expires_at > now() or pinned)`).
-- Twenty hours, not thirty days: the 24h story is the product rule, and a seeded world that
-- quietly kept its stories forever would stop testing the expiry it is supposed to exercise.
update public.story_segments
   set expires_at = now() + interval '20 hours',
       deleted_at = null
 where id in (
   select md5('story:' || s.handle || ':' || s.n)::uuid
   from (values
     ('marta_ceramica', 1), ('tino_chef', 1), ('bea_foto', 1),
     ('dario_legno', 1), ('dario_legno', 2), ('ele_yoga', 1),
     ('vera_erbe', 1), ('gio_musica', 1), ('sole_designer', 1)
   ) as s(handle, n)
 );

insert into public.story_reactions (id, segment_id, person_id)
select md5('storyreact:' || r.reactor || ':' || r.author)::uuid,
       md5('story:' || r.author || ':1')::uuid, md5('user:' || r.reactor)::uuid
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

-- One image message per conversation (#613), sent by the persona you are NOT told to start
-- on, so whoever walks as sole_designer / marta_ceramica / rocco_film finds a PEER image
-- bubble — the only kind that carries the long-press report affordance (own bubbles do
-- not, PR #610). Two shapes on purpose: image-only (body null, the preview falls back to
-- '📷') and image + caption. The key is exactly what messages_insert_own_user pins since
-- #575 — `{sender_uid}/{conversation_id}/{media_id}.jpg`, lowercase-hex uuids — with the
-- message's own id standing in as media_id, so `pnpm staging:media` can derive it the same
-- way it derives every other row. The upload run puts the bytes at that key (chat-media,
-- image/jpeg only since 20260831064705); until it runs the bubble is a blank rectangle.
-- Idempotent beside any hand-inserted pair a walker left: those carry random ids.
insert into public.messages (id, conversation_id, sender_id, kind, body, media_url, created_at)
select md5('msg:' || m.a || ':' || m.b || ':' || m.n)::uuid,
       md5('conv:' || least(m.a, m.b) || ':' || greatest(m.a, m.b))::uuid,
       md5('user:' || m.sender)::uuid, 'user'::public.message_kind, m.body,
       case when m.image
            then md5('user:' || m.sender)::uuid::text || '/'
                 || md5('conv:' || least(m.a, m.b) || ':' || greatest(m.a, m.b))::uuid::text || '/'
                 || md5('msg:' || m.a || ':' || m.b || ':' || m.n)::uuid::text || '.jpg'
            end,
       now() - ((10 - m.n) || ' hours')::interval
from (values
  ('sole_designer',  'luna_dev',   1, 'sole_designer',  'Ho visto il tuo dream. Il sito te lo faccio io, davvero.', false),
  ('sole_designer',  'luna_dev',   2, 'luna_dev',       'Deal. What do you want in return?', false),
  ('sole_designer',  'luna_dev',   3, 'sole_designer',  'Che mi dici la verità sul mio portfolio.', false),
  ('sole_designer',  'luna_dev',   4, 'luna_dev',       'That is a worse deal for you. Thursday?', false),
  ('sole_designer',  'luna_dev',   5, 'sole_designer',  'Allora ci vediamo giovedì.', false),
  ('sole_designer',  'luna_dev',   6, 'luna_dev',       null, true),
  ('marta_ceramica', 'bea_foto',   1, 'bea_foto',       'Quando accendi il forno? Vorrei esserci.', false),
  ('marta_ceramica', 'bea_foto',   2, 'marta_ceramica', 'Giovedì alle sei. È ancora buio, portati il cavalletto.', false),
  ('marta_ceramica', 'bea_foto',   3, 'bea_foto',       'Porto la macchina grande.', false),
  ('marta_ceramica', 'bea_foto',   4, 'bea_foto',       'La merceria, ieri. Così la vedi prima del forno.', true),
  ('rocco_film',     'gio_musica', 1, 'gio_musica',     'Per il documentario: la cantina è insonorizzata adesso.', false),
  ('rocco_film',     'gio_musica', 2, 'rocco_film',     'Quando posso venire a sentire?', false),
  ('rocco_film',     'gio_musica', 3, 'gio_musica',     'La stanza è libera martedì.', false),
  ('rocco_film',     'gio_musica', 4, 'gio_musica',     null, true)
) as m(a, b, n, sender, body, image)
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
--    No `reasons` column: it is retired (#273 D). The deck computes each card's terms at read
--    time from the candidate's CURRENT, visibility-masked tags, so a hand-written string here
--    would render nothing and mislead the next reader. The affinity values below are what the
--    matcher would score for these pairs; anything under 2 is a card the matcher itself would
--    no longer propose, kept here only as an already-swiped (passed) row.
insert into public.momento_proposals (id, user_id, candidate_id, affinity, status, proposed_on, daily_rank)
select md5('momento:' || m.a || ':' || m.b)::uuid,
       md5('user:' || m.a)::uuid, md5('user:' || m.b)::uuid, m.affinity,
       m.status::public.momento_status, current_date, m.rank
from (values
  ('sole_designer',  'gio_musica',    2.0, 'pending',  1),
  ('gio_musica',     'sole_designer', 2.0, 'pending',  1),
  ('marta_ceramica', 'sara_startup',  2.0, 'pending',  2),
  ('ele_yoga',       'bea_foto',      2.0, 'pending',  1),
  ('bea_foto',       'nina_poeta',    2.0, 'pending',  2),
  ('vera_erbe',      'nina_poeta',    1.0, 'passed',   1),
  -- reciprocal accepted pairs → mutual match, and the two conversations in §7
  ('sole_designer',  'luna_dev',      2.0, 'accepted', 2),
  ('luna_dev',       'sole_designer', 2.0, 'accepted', 1),
  ('rocco_film',     'gio_musica',    2.0, 'accepted', 2),
  ('gio_musica',     'rocco_film',    2.0, 'accepted', 2)
) as m(a, b, affinity, status, rank)
on conflict do nothing;

-- ---------------------------------------------------------------------------------
-- 9. Moments (the 24h photo/video kind).
--    marta_ceramica's is the video one, which is the only row in the seed that exercises
--    thumb_path — the poster frame a video tile shows before playback. A grid of five photos
--    would never touch that column.
-- ---------------------------------------------------------------------------------
insert into public.moments (id, owner_id, kind, media_path, thumb_path, duration_s, caption, width, height)
select md5('moment:' || m.handle)::uuid, md5('user:' || m.handle)::uuid, m.kind::public.moment_kind,
       md5('user:' || m.handle)::uuid::text || '/' || md5('moment:' || m.handle)::uuid::text
         || (case when m.kind = 'video' then '.mp4' else '.jpg' end),
       case when m.kind = 'video'
            then md5('user:' || m.handle)::uuid::text || '/' || md5('moment:' || m.handle)::uuid::text || '-thumb.jpg'
            else null end,
       m.duration_s, m.caption, m.w, m.h
from (values
  -- width/height describe the FILE, and transcode-media.sh encodes photos at the 4:5 card crop
  -- and video at the 9:16 story crop. Declaring 1080x1350 for the video would make the grid
  -- reserve a card-shaped box and then letterbox a portrait clip into it.
  ('sole_designer',  'photo', null, 'Le chiavi.',         1080, 1350),
  ('marta_ceramica', 'video', 9,    'Crepata, ma bella.', 1080, 1920),
  ('tino_chef',      'photo', null, 'Il burro giusto.',   1080, 1350),
  ('rocco_film',     'photo', null, 'Ottantasei anni.',   1080, 1350),
  ('dario_legno',    'photo', null, 'Tiene.',             1080, 1350)
) as m(handle, kind, duration_s, caption, w, h)
on conflict do nothing;

-- Re-run repair, same reason as the story refresh in §6. These three predate the media change,
-- so on an already-seeded project `on conflict do nothing` leaves them holding the old
-- handle-prefixed key (moments), the old fake URL (candidacies), or `type = 'text'` (posts) —
-- and the upload script, which reads keys out of the DB by design, would then POST bytes to a
-- path the bucket policy rejects. A project seeded from empty never executes any of this.
-- The owner uid comes from the row's own FK, never from md5('user:' || handle). For a seeded row
-- the two are identical, but for anything else the hash would write a first path segment that is
-- not the owner's uid — a key no client could upload to and no client could read. The guards
-- below already exclude app-written rows; taking the uid from the FK means that if one ever did
-- slip through, the repair still produces a correct key instead of a broken one.
--
-- Only rows whose key is NOT already uid-prefixed, so a moment created in the app (which always
-- writes the canonical shape) is never touched.
update public.moments m set
    media_path = m.owner_id::text || '/' || m.id::text
                 || (case when m.kind = 'video' then '.mp4' else '.jpg' end),
    thumb_path = case when m.kind = 'video'
                      then m.owner_id::text || '/' || m.id::text || '-thumb.jpg'
                      else m.thumb_path end,
    width      = case when m.kind = 'video' then 1080 else m.width end,
    height     = case when m.kind = 'video' then 1920 else m.height end
 where m.media_path !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/';

update public.dream_candidacies c
   set video_url = c.profile_id::text || '/' || c.id::text || '.mp4'
 where c.video_url like 'http%';

-- Repairs rows seeded before thumb_path existed (the column shipped in
-- 20260812120121_candidacy_thumb_path.sql) — the same role the video_url normalizer above plays
-- for its own pre-migration rows. The INSERT below now sets thumb_path directly, so on a fresh
-- seed this matches zero rows; on staging's three already-seeded candidacies it backfills them,
-- which is the only reason this UPDATE is still here.
-- Scoped to those three seeded ids, not every row, unlike video_url's `like 'http%'` guard being
-- the only one that looked needed: candidacy_window_open = true and the seed's three candidacy
-- authors are identity_verified (§12), so a tester can submit a real candidacy through the
-- wizard — the exact create/edit flow this PR's poster extraction covers. That candidacy's
-- thumb_path may legitimately be null (extraction is best-effort and can fail, by design), and
-- an unscoped UPDATE would stamp it with a key the uploader manifest never populated for it —
-- turning an honest null into the state-confusion this PR exists to eliminate. The id filter
-- mirrors the INSERT's own derivation below, so it can never drift from the rows that seeds.
update public.dream_candidacies c
   set thumb_path = c.profile_id::text || '/' || c.id::text || '-thumb.jpg'
 where c.id in (md5('candidacy:marta_ceramica')::uuid,
                md5('candidacy:ele_yoga')::uuid,
                md5('candidacy:rocco_film')::uuid);

-- Same role for dream_id (#227): the INSERT below sets it, but the three candidacies are
-- already on staging and it carries `on conflict do nothing`, so without this the existing
-- fake world would keep a null link and the ballot's confirmed-history block would never
-- render there. Scoped by id to the seeded three for the reason stated above — a tester's own
-- candidacy may legitimately link no dream, and that is a choice #226 made first-class, not a
-- gap to fill. `where c.dream_id is null` so a tester who edited one of these does not have
-- their link overwritten.
-- Same on-conflict-do-nothing reason as the dream_id backfill below: ele_yoga's row already
-- exists on staging with the pre-#218 'submitted' status.
update public.dream_candidacies c
   set status = 'shortlisted'
 where c.id = md5('candidacy:ele_yoga')::uuid
   and c.status = 'submitted';

update public.dream_candidacies c
   set dream_id = d.id
  from public.dreams d
 where d.profile_id = c.profile_id
   and d.deleted_at is null
   and d.status = 'active'
   and c.dream_id is null
   and c.id in (md5('candidacy:marta_ceramica')::uuid,
                md5('candidacy:ele_yoga')::uuid,
                md5('candidacy:rocco_film')::uuid);

-- Pinned to the seeded post id, not "every post by these four handles". A post a tester wrote in
-- the app carries no post_media row, and flipping it to 'image' costs a media query per card and
-- renders an empty box — the same principle the moments guard above states.
update public.posts p
   set type = 'image'::public.post_type
  from public.profiles pr
 where pr.id = p.author_id
   and pr.handle in ('bea_foto', 'ele_yoga', 'vera_erbe', 'nina_poeta')
   and p.id = md5('post:' || pr.handle || ':1')::uuid
   and p.type <> 'image';

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
-- 12. Fund cycle + candidacies + votes.
--     phase = 'voting' — cast_vote() gates on it (20260815075408 renamed the phase
--     vocabulary; 'community' no longer exists), which is what makes voting walkable.
--     candidacy_window_open stays true beside it so the candidacy wizard is walkable
--     too — the two gates are independent columns.
--     The three min_* columns are NOT NULL with no default (FUND-SPEC §5): the seed
--     CHOOSES fake-world values — floor €1.000, quorum 5 (six votes below → decisive),
--     3 candidacies — the same values 20260815075408 backfilled the pre-existing row
--     with. The voting window is published AND enforced (20260815090015, #217): cast_vote
--     refuses outside [voting_starts_at, voting_ends_at], so keep the seeded window
--     spanning now() or the fake world's voting stops being walkable. THIS INSERT IS NOT
--     THAT MECHANISM (#414): the span is a now()-snapshot written once, and the trailing
--     `on conflict do nothing` means a re-run neither refreshes it nor ever reaches the
--     pre-existing row, which predates the two columns carrying values. refresh-staging.sql
--     §11 re-stamps the window hourly instead — change the offsets here and change them
--     there too. The direct INSERT into phase = 'voting' below deliberately bypasses the
--     ballot-open trigger — it fires on UPDATE OF phase only, precisely so this
--     bootstrap stays legal before the candidacies exist.
--     `candidacy_votes.weight` is NOT supplied: set_candidacy_vote_weight() is a
--     BEFORE INSERT trigger that raises 'weight is server-written' for any non-zero
--     value, service_role included. It writes a constant 1.000 — equal vote (PRD §4.11).
--     Candidacy authors are all identity_verified in §1, so the create/edit flow is
--     actually walkable from the app. They are no longer the ONLY verified accounts:
--     since #448 the three paid-event organisers are verified too, because the gate
--     refuses a paid event whose organiser is not.
--     Contributions are NOT seeded — those are Stripe's to create, in test mode.
-- ---------------------------------------------------------------------------------
insert into public.fund_editions (id, target_at, goal_cents, phase, candidacy_window_open, contributions_enabled,
                                  voting_starts_at, voting_ends_at,
                                  min_funding_cents, min_voters, min_candidacies,
                                  split_pct, cost_fee_statement, equity_declared)
values (md5('fundedition:2027')::uuid,
        (date_trunc('year', now()) + interval '1 year' + interval '5 months')::timestamptz,
        5000000, 'voting', true, true,
        now() - interval '7 days', now() + interval '23 days',
        100000, 5, 3,
        -- Cycle-one declarations (#232, D16): 10% knowingly subsidised, equity none.
        -- Same values 20260815155811 backfilled into the pre-existing row; frozen at open,
        -- so a re-run can only ever re-create them identically, never amend them.
        10,
        'Per questo ciclo Athanor trattiene il 10%. La percentuale copre solo in parte i costi operativi e le commissioni di pagamento; la differenza è volutamente a carico di Athanor. I costi reali sono pubblicati nel report di fine ciclo.',
        'Nessuna partecipazione societaria nel progetto per questo ciclo.')
on conflict do nothing;

-- `video_url` is misnamed: it holds a STORAGE KEY in the candidacy-videos bucket, not a URL.
-- candidacy/[id].tsx feeds it straight to signMediaUrls, and candidacy.tsx writes
-- candidacyVideoPath(uid, candidacyId) into it — `{uid}/{candidacy_id}.mp4`
-- (packages/api/src/candidacy.ts:26). The old 'https://example.invalid/video/<handle>' could
-- never sign, so the candidacy detail has always shown an empty player.
-- `thumb_path` is set here too, from the same two ids, so a fresh seed is correct on its own —
-- the standalone UPDATE further up only exists to backfill rows inserted before this column did.
-- budget_cents / min_viable_cents are NOT NULL with no default (#225): the seed CHOOSES the
-- same fake-world values 20260815080109 backfilled the pre-existing rows with. category uses
-- the project_category enum as-is (the old 'craft'/'wellbeing' values fail its CHECK);
-- skills_needed keys come from @athanor/core SKILLS.
-- ele_yoga is 'shortlisted' rather than 'submitted' since #227. Not a taste change: #218
-- narrowed public.is_on_ballot to ('shortlisted','winner') (20260815164809), so the two
-- 'submitted' rows stopped being visible on the ballot at all and staging's fake ballot became
-- a single card — enough to hide the category filter (which needs two categories) and to make
-- the vote look broken. Two shortlisted candidacies in two categories restore a real ballot;
-- rocco_film stays 'submitted' so the pre-screening state is still represented in the world.
--
-- dream_id (#227, FUND-50/D12): each of the three candidates already owns an active dream
-- with milestones under §2, and the ballot card renders that dream's confirmed history. Left
-- unset the block could never appear on staging — the feature would look unbuilt rather than
-- unlinked. md5('dream:' || handle) is the author's OWN dream, which is what the write
-- policies require of a real submission.
insert into public.dream_candidacies (id, edition_id, profile_id, story, goal, impact, video_url, thumb_path, plan, status, city, category,
                                      budget_cents, min_viable_cents, skills_needed, dream_id)
select md5('candidacy:' || c.handle)::uuid, md5('fundedition:2027')::uuid, md5('user:' || c.handle)::uuid,
       c.story, c.goal, c.impact,
       md5('user:' || c.handle)::uuid::text || '/' || md5('candidacy:' || c.handle)::uuid::text || '.mp4',
       md5('user:' || c.handle)::uuid::text || '/' || md5('candidacy:' || c.handle)::uuid::text || '-thumb.jpg',
       c.plan, c.status, c.city, c.category, c.budget_cents, c.min_viable_cents, c.skills_needed,
       md5('dream:' || c.handle)::uuid
from (values
  ('marta_ceramica', 'Faccio ceramica da undici anni in uno studio in affitto che devo lasciare.', 'Un forno mio e un laboratorio aperto a chi vuole imparare.', 'Otto corsi l''anno, gratuiti per chi non può pagarli.', 'Forno usato, impianto elettrico, sei mesi di affitto.',  'shortlisted', 'Milano', 'artistic',  800000::bigint,  500000::bigint, array['social-media','fotografia']),
  ('ele_yoga',       'Insegno yoga da sei anni. Da due lo porto in una casa di riposo, gratis.',    'Arrivare a cinque strutture, con insegnanti pagati.',        'Duecento persone che non uscirebbero di casa.',         'Formazione di quattro insegnanti, un anno di compensi.', 'shortlisted', 'Milano', 'volunteer', 1200000::bigint, 600000::bigint, array['coaching','facilitazione']),
  ('rocco_film',     'Filmo mestieri che stanno sparendo. Ne restano cinque sulla costa.',          'Cinque episodi finiti e distribuiti.',                       'Un archivio di cose che tra dieci anni non ci sono più.','Attrezzatura, viaggi, montaggio.',                       'submitted',   'Genova', 'artistic',  1500000::bigint, 900000::bigint, array['montaggio','sound-design'])
) as c(handle, story, goal, impact, plan, status, city, category, budget_cents, min_viable_cents, skills_needed)
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
-- fund_surfaces_enabled and prime_stelle_enabled to false on production, and
-- fund_editions.contributions_enabled carries a "LEGAL FLAG: gated until counsel
-- clears" comment. They are true here so the flows can be walked in Stripe test mode.
-- Do not copy this block to production.
-- ---------------------------------------------------------------------------------
insert into public.remote_config (key, value) values
  ('min_app_version',           '{"ios":"1.0.0","android":"1.0.0"}'::jsonb),
  ('maintenance_mode',          '{"enabled":false,"eta":null}'::jsonb),
  ('fund_surfaces_enabled',     '{"enabled":true}'::jsonb),
  ('prime_stelle_enabled',      '{"enabled":true}'::jsonb)
on conflict do nothing;

commit;

-- ---------------------------------------------------------------------------------
-- Summary — read this after running. `aura_events` is engine-written: expect 6
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
union all select 'post_media (needs the upload run)', count(*) from public.post_media
union all select 'stories', count(*) from public.story_segments
union all select 'avatars set (needs the upload run)', count(*) from public.profiles where avatar_path is not null
union all select 'connections', count(*) from public.connections
union all select 'conversations', count(*) from public.conversations
union all select 'messages', count(*) from public.messages
union all select 'chat images (needs the upload run)', count(*) from public.messages where media_url is not null
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
