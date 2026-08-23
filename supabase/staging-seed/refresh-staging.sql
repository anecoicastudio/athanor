-- Athanor — STAGING world refresh (installer).
--
-- The seeded world decays while it is being tested: a swiped Momento never comes back
-- (pair-unique + the matcher's never-re-propose rule), stories expire after 20 hours,
-- events drift into the past, statuses get flipped by walking the flows. This file
-- installs `public.staging_refresh_world()` plus an HOURLY pg_cron job that restores
-- the seeded world, so the app always has a full deck, a live story rail and a
-- populated calendar without re-seeding.
--
-- RESTORATIVE, NOT A WIPE. The function only touches rows the seed created (semantic
-- md5 ids) plus the seeded personas' momento decks. Content a tester creates — posts,
-- messages, accounts, swipes on their own non-persona account — survives every run.
-- The full pristine reset stays the manual runbook in README.md ("Re-running").
--
-- NOT A MIGRATION, ON PURPOSE. Migrations flow staging → production; this must never
-- reach production, so it lives here and is run by hand, gated exactly like the seed:
--
--     psql "<staging pooler url>" -v ON_ERROR_STOP=1 \
--       -c "set app.settings.seed_confirm = 'yes'" \
--       -f supabase/staging-seed/refresh-staging.sql
--
-- (or the single Management-API /database/query call with the `set` prepended — one
-- call is one session, which gate 2 requires; see README.md.)
--
-- ⚠ KEEP IN STEP WITH seed-staging.sql. Every VALUES list below (stories, events,
-- statuses, content ids) is a frozen copy of the seed's semantic keys, as are §11's
-- ballot-window offsets. Any seed edit that touches those sections requires re-running
-- THIS file. The momento deck is the exception: it is computed from live profiles with
-- the matcher's own scoring, so it self-heals when tags change.
--
-- WHAT IT DELIBERATELY DOES NOT RESTORE (and why):
--   consent / notification_preferences — pure preference toggles; hourly reversion
--     would sabotage testing the toggles themselves.
--   post_reactions / story_reactions   — the toggle is the feature; hourly re-adding
--     an un-toggled reaction would fight the tester's hand.
--   reports / audit_log                — a resolved report is real admin-panel work,
--     not decay. Re-seed to refill the queue.
--   connections / conversations / messages — never destroyed by decay; deleting or
--     restoring them would destroy tester history.
--   GoTrue-side ban state              — profiles.banned_at is cleared, but a ban
--     applied through the admin panel also lives in the auth server and must be
--     lifted from the Dashboard (or Admin API). SQL cannot reach it.
--   fund_editions.target_at            — cosmetic countdown, and nothing gates on it:
--     annual.tsx's CountdownGrid and DreamHeroCard are its only readers. The ballot
--     window beside it is NOT in this list any more — §11 restores it, because
--     cast_vote does gate on that one (#414).
--   fund_editions.phase / candidacy_window_open — walking the cycle forward is real
--     testing, not decay. Re-entering 'voting' also fires the ballot-open trigger,
--     which demands a declared window AND min_candidacies votable candidacies; the
--     seed's own INSERT only escapes it by never being an UPDATE. Full pristine
--     reset to rewind a walked cycle.
--   tester accounts' own momento decks — sign in as a persona to re-test swiping, or
--     wait for the nightly matcher.
--
-- The function is additionally SELF-GATED on the staging Vault marker, so even if it
-- somehow traveled (dump/PITR/clone), it is inert anywhere but staging.

begin;

-- ---------------------------------------------------------------------------------
-- GUARD — the seed's two gates, verbatim (see seed-staging.sql for the full why:
-- gate 1 is the Vault environment marker, gate 2 must be typed in THIS session
-- because Vault contents travel with a restore and a session setting cannot).
-- ---------------------------------------------------------------------------------
do $$
begin
  if coalesce(athanor.runtime_setting('environment'), '') <> 'staging' then
    raise exception
      'REFUSING TO INSTALL: the environment marker is %, expected ''staging''. If this really is staging: select vault.create_secret(''staging'', ''app.settings.environment'');',
      coalesce(athanor.runtime_setting('environment'), '<unset>');
  end if;
  if coalesce(current_setting('app.settings.seed_confirm', true), '') <> 'yes' then
    raise exception
      'REFUSING TO INSTALL: run "set app.settings.seed_confirm = ''yes'';" in this session first. This gate exists because the environment marker survives a restore and could follow staging into production.';
  end if;
end $$;

-- ---------------------------------------------------------------------------------
-- The refresh. Diff-aware throughout: an untouched world produces zero restorative
-- writes, so an idle hour fires no triggers and produces no notifications (§13's
-- notification prune is the one bookkeeping delete that may still run).
--
-- ⚠ gen:types: once this is installed, the next `pnpm gen:types` run (which reads
-- staging) will add `staging_refresh_world` to database.types.ts `Functions`. That
-- is expected, not schema drift — the RPC exists only on staging and only
-- service_role can execute it.
-- ---------------------------------------------------------------------------------
create or replace function public.staging_refresh_world()
returns jsonb
language plpgsql
-- SECURITY DEFINER for the same reason run_momenti_matcher() is: it writes tables
-- (momento_proposals above all) whose client grants deny these writes, and the
-- pg_cron / Management-API calling context holds no direct grant on them.
security definer
set search_path = ''
as $$
declare
  v_personas      uuid[];
  v_dirty         uuid[];
  v_today         date := (now() at time zone 'utc')::date;
  v_dreams        int  := 0;
  v_content       int  := 0;
  v_milestones    int  := 0;
  v_helps         int  := 0;
  v_creqs         int  := 0;
  v_rsvps         int  := 0;
  v_moderation    int  := 0;
  v_stories       int  := 0;
  v_events        int  := 0;
  v_ballot        int  := 0;
  v_deck_deleted  int  := 0;
  v_deck_inserted int  := 0;
  v_notifs        int  := 0;
  v_reminders     int  := 0;
  r               int;
begin
  -- §0 Self-gate. First statement: inert anywhere the staging marker is absent.
  if coalesce(athanor.runtime_setting('environment'), '') <> 'staging' then
    return jsonb_build_object('skipped', 'environment marker is not staging');
  end if;

  -- §1 The persona set, derived rather than hardcoded: the mail domain is
  -- unreachable, so no app signup can ever confirm into it.
  select array_agg(u.id) into v_personas
    from auth.users u
   where u.email like '%@staging.athanor.local';

  if v_personas is null then
    return jsonb_build_object('skipped', 'no seeded personas — run seed-staging.sql first');
  end if;

  -- §2 Dreams back to active (a non-active dream removes the persona from both the
  -- matcher and the deck). Guarded by the one-active-dream partial unique index: if
  -- the tester archived a seeded dream and wrote a new active one, leave both alone.
  update public.dreams d
     set status = 'active', deleted_at = null
   where d.id in (select md5('dream:' || h.handle)::uuid from (values
           ('sole_designer'), ('luna_dev'), ('marta_ceramica'), ('gio_musica'),
           ('ele_yoga'), ('tino_chef'), ('vera_erbe'), ('rocco_film'),
           ('sara_startup'), ('dario_legno'), ('nina_poeta'), ('bea_foto')
         ) as h(handle))
     and (d.status <> 'active' or d.deleted_at is not null)
     and not exists (select 1 from public.dreams o
                      where o.profile_id = d.profile_id and o.id <> d.id
                        and o.status = 'active' and o.deleted_at is null);
  get diagnostics v_dreams = row_count;

  -- §3 Un-soft-delete seeded content. Scoped to the seeded ids, never to authorship —
  -- content a tester wrote while signed in AS a persona is not touched.
  update public.posts set deleted_at = null
   where deleted_at is not null
     and id in (select md5('post:' || h.handle || ':1')::uuid from (values
           ('sole_designer'), ('luna_dev'), ('marta_ceramica'), ('gio_musica'),
           ('ele_yoga'), ('tino_chef'), ('vera_erbe'), ('rocco_film'),
           ('sara_startup'), ('dario_legno'), ('nina_poeta'), ('bea_foto')
         ) as h(handle));
  get diagnostics r = row_count; v_content := v_content + r;

  update public.post_comments set deleted_at = null
   where deleted_at is not null
     and id in (select md5('comment:' || c.commenter || ':' || c.post_handle)::uuid from (values
           ('bea_foto', 'marta_ceramica'), ('tino_chef', 'vera_erbe'),
           ('sara_startup', 'luna_dev'), ('nina_poeta', 'bea_foto'),
           ('sole_designer', 'dario_legno')
         ) as c(commenter, post_handle));
  get diagnostics r = row_count; v_content := v_content + r;

  update public.moments set deleted_at = null
   where deleted_at is not null
     and id in (select md5('moment:' || h.handle)::uuid from (values
           ('sole_designer'), ('marta_ceramica'), ('tino_chef'), ('rocco_film'), ('dario_legno')
         ) as h(handle));
  get diagnostics r = row_count; v_content := v_content + r;

  update public.projects set deleted_at = null
   where deleted_at is not null
     and id in (select md5('project:' || p.handle || ':' || p.title)::uuid from (values
           ('sara_startup', 'Cerco co-founder tecnico'),
           ('rocco_film',   'Documentario sui maestri d''ascia'),
           ('tino_chef',    'Locanda a otto coperti'),
           ('vera_erbe',    'Mapping the paths'),
           ('luna_dev',     'Sleep study, small n')
         ) as p(handle, title));
  get diagnostics r = row_count; v_content := v_content + r;

  update public.favor_offers set deleted_at = null
   where deleted_at is not null
     and id in (select md5('favor:' || f.actor || ':' || f.target)::uuid from (values
           ('tino_chef', 'ele_yoga'), ('nina_poeta', 'rocco_film'), ('luna_dev', 'sole_designer')
         ) as f(actor, target));
  get diagnostics r = row_count; v_content := v_content + r;

  -- §4 Milestone statuses back to the seeded three-state spread. Reset direction
  -- fires no award (the M6 trigger is on → done), and re-earning dedupes.
  update public.dream_milestones m
     set status = x.status::public.milestone_status, deleted_at = null
    from (values
      ('sole_designer',  0, 'done'), ('sole_designer', 1, 'in_progress'), ('sole_designer', 2, 'open'),
      ('luna_dev',       0, 'done'), ('luna_dev',      1, 'in_progress'),
      ('marta_ceramica', 0, 'done'), ('marta_ceramica',1, 'in_progress'),
      ('gio_musica',     0, 'in_progress'), ('gio_musica', 1, 'open'),
      ('ele_yoga',       0, 'done'), ('ele_yoga',      1, 'open'),
      ('rocco_film',     0, 'done'), ('rocco_film',    1, 'open')
    ) as x(handle, position, status)
   where m.id = md5('ms:' || x.handle || ':' || x.position)::uuid
     and (m.status <> x.status::public.milestone_status or m.deleted_at is not null);
  get diagnostics v_milestones = row_count;

  -- §5 Help offers back to their seeded states. The guard trigger rejects reverse
  -- transitions even in this context, so a changed row is DELETEd and re-INSERTed
  -- (which re-fires the offer notification — an honest one, only after tester action).
  delete from public.milestone_helps mh
   using (values
     ('sara_startup', 'sole_designer',  1, 'completed'),
     ('bea_foto',     'marta_ceramica', 1, 'accepted'),
     ('gio_musica',   'rocco_film',     1, 'offered'),
     ('dario_legno',  'ele_yoga',       1, 'offered')
   ) as s(helper, ms_handle, ms_pos, status)
   where mh.id = md5('help:' || s.helper || ':' || s.ms_handle || ':' || s.ms_pos)::uuid
     and mh.status <> s.status::public.help_status;
  get diagnostics v_helps = row_count;

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

  -- §6 Connection requests back to their seeded states — same DELETE+INSERT dance
  -- (guard trigger), but SKIPPED for any pair that now holds a connections row:
  -- restoring "pending" beside an established connection would be contradictory, and
  -- the seeded accepted requests fall out naturally (their connections are seeded).
  -- source_request_id is on-delete-set-null, so the delete never destroys a connection.
  delete from public.connection_requests cr
   using (values
     ('sole_designer',  'luna_dev',      'accepted'),
     ('marta_ceramica', 'bea_foto',      'accepted'),
     ('rocco_film',     'gio_musica',    'accepted'),
     ('nina_poeta',     'sole_designer', 'pending'),
     ('sara_startup',   'tino_chef',     'pending'),
     ('vera_erbe',      'dario_legno',   'declined')
   ) as s(a, b, status)
   where cr.id = md5('creq:' || s.a || ':' || s.b)::uuid
     and cr.status <> s.status::public.connection_status
     and not exists (select 1 from public.connections cn
                      where cn.profile_a = least(md5('user:' || s.a)::uuid, md5('user:' || s.b)::uuid)
                        and cn.profile_b = greatest(md5('user:' || s.a)::uuid, md5('user:' || s.b)::uuid));
  get diagnostics v_creqs = row_count;

  insert into public.connection_requests (id, requester_id, addressee_id, status, responded_at)
  select md5('creq:' || s.a || ':' || s.b)::uuid,
         md5('user:' || s.a)::uuid, md5('user:' || s.b)::uuid,
         s.status::public.connection_status,
         case when s.status = 'pending' then null else now() - interval '2 days' end
  from (values
    ('sole_designer',  'luna_dev',      'accepted'),
    ('marta_ceramica', 'bea_foto',      'accepted'),
    ('rocco_film',     'gio_musica',    'accepted'),
    ('nina_poeta',     'sole_designer', 'pending'),
    ('sara_startup',   'tino_chef',     'pending'),
    ('vera_erbe',      'dario_legno',   'declined')
  ) as s(a, b, status)
  where not exists (select 1 from public.connections cn
                     where cn.profile_a = least(md5('user:' || s.a)::uuid, md5('user:' || s.b)::uuid)
                       and cn.profile_b = greatest(md5('user:' || s.a)::uuid, md5('user:' || s.b)::uuid))
  on conflict do nothing;

  -- §7 RSVPs back to the seeded spread (no guard trigger; at seeded counts the
  -- capacity trigger is trivially satisfied).
  update public.rsvps rv
     set status = s.status
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
    ) as s(handle, slug, status)
   where rv.id = md5('rsvp:' || s.handle || ':' || s.slug)::uuid
     and rv.status <> s.status;
  get diagnostics v_rsvps = row_count;

  -- §8 Clear SQL-side moderation state on personas (a walked suspend/ban flow would
  -- otherwise lock a persona's login out of the whole world). The GoTrue half of a
  -- ban is NOT reachable from SQL — lift it in the Dashboard.
  update public.profiles p
     set suspended_until = null, banned_at = null
   where p.id = any(v_personas)
     and (p.suspended_until is not null or p.banned_at is not null);
  get diagnostics v_moderation = row_count;

  -- §9 Stories: the seed's own re-run repair, made hourly. Only when a segment is
  -- inside 4 hours of expiry (or already pruned), so the countdown visibly ticks
  -- 20h → 4h in the app and idle hours write nothing. The 03:17 prune never wins.
  update public.story_segments
     set expires_at = now() + interval '20 hours', deleted_at = null
   where id in (select md5('story:' || s.handle || ':' || s.n)::uuid from (values
           ('marta_ceramica', 1), ('tino_chef', 1), ('bea_foto', 1),
           ('dario_legno', 1), ('dario_legno', 2), ('ele_yoga', 1),
           ('vera_erbe', 1), ('gio_musica', 1), ('sole_designer', 1)
         ) as s(handle, n))
     and (expires_at < now() + interval '4 hours' or deleted_at is not null);
  get diagnostics v_stories = row_count;

  -- §10 Events: re-stamp the four future ones to their seeded offsets once they decay
  -- within 3 days of now (below the smallest offset, so a fresh seed is untouched),
  -- and clear any live-window state the every-minute sweep stamped on an aged event —
  -- a re-future-dated event must not carry live_started_at from its past life.
  with restamped as (
    update public.events e
       set starts_at = now() + (x.offset_days || ' days')::interval,
           ends_at   = now() + (x.offset_days || ' days')::interval + interval '2 hours',
           live_started_at = null, live_ended_at = null, deleted_at = null
      from (values
        ('cena-condivisa', 4), ('yoga-alba', 9), ('ascolto-disco', 16), ('kairos-ottobre', 25)
      ) as x(slug, offset_days)
     where e.id = md5('event:' || x.slug)::uuid
       and (e.starts_at < now() + interval '3 days' or e.deleted_at is not null)
    returning e.id
  ),
  wiped as (
    delete from public.event_live_stats s using restamped r where s.event_id = r.id
  )
  select count(*) into v_events from restamped;

  -- bottega-aperta stays deliberately past (−6 days) but must not drift forever.
  update public.events e
     set starts_at = now() - interval '6 days',
         ends_at   = now() - interval '6 days' + interval '2 hours',
         deleted_at = null
   where e.id = md5('event:bottega-aperta')::uuid
     and (e.starts_at < now() - interval '14 days' or e.deleted_at is not null);
  get diagnostics r = row_count; v_events := v_events + r;

  -- §10b #126 reminder fixtures. Both offsets are sub-daily, so unlike §10's day-scale
  -- events these decay out of their windows within one refresh interval. Re-stamped
  -- whenever they have drifted below their seeded offset at all (time only moves one way,
  -- so in practice every run after the first), and never pushed further out than seeded.
  -- Same CTE shape as §10, for the same reason: diretta-tra-poco is online and goes live
  -- 30 minutes after every re-stamp, so by the next refresh it carries live_started_at and
  -- an event_live_stats.is_live = true row. Nulling the window columns alone would strand
  -- that row at true forever — live_window_sweep's close branch keys on live_started_at,
  -- which would be null — and the Live panel would show an event 30 minutes in the future
  -- as live. The stats row has to go with the window.
  with restamped_reminders as (
    update public.events e
       set starts_at = now() + x.offset_in,
           ends_at   = now() + x.offset_in + interval '2 hours',
           live_started_at = null, live_ended_at = null, deleted_at = null
      from (values
        ('promemoria-oggi',  interval '5 hours'),
        ('diretta-tra-poco', interval '30 minutes')
      ) as x(slug, offset_in)
     where e.id = md5('event:' || x.slug)::uuid
       and (e.starts_at < now() + x.offset_in or e.deleted_at is not null)
    returning e.id
  ),
  wiped_reminders as (
    delete from public.event_live_stats s using restamped_reminders r where s.event_id = r.id
  )
  select count(*) into r from restamped_reminders;
  v_events := v_events + r;

  -- …and drop their send markers, so the next minute's sweep enqueues the reminder again.
  -- Scoped to these two ids: a marker on any other event is a real send and stays, which is
  -- also what keeps this from masking a producer that fires more than once.
  delete from athanor.event_reminder_sends
   where event_id in (md5('event:promemoria-oggi')::uuid,
                      md5('event:diretta-tra-poco')::uuid);
  get diagnostics v_reminders = row_count;

  -- §11 Fund ballot window: the same re-stamp, for the one time-relative column a
  -- gate actually reads. cast_vote refuses outside [voting_starts_at, voting_ends_at]
  -- (20260815090015, #217) and NULL null-propagates to a refusal, so a closed or
  -- undeclared window makes the fake world's ballot inert — every cast and every move
  -- raises 'voting closed'. The seed writes the span once, at INSERT, behind
  -- `on conflict do nothing` (seed-staging.sql §12): the pre-existing 2027 row was
  -- inserted before those columns carried values and can never receive them, and even
  -- a from-zero seed closes 23 days later with no re-run able to reopen it. Only an
  -- hourly UPDATE fixes both, which is why this lives here and not in the seed (#414).
  -- Threshold 7 days, below the seeded +23 so a fresh seed is untouched.
  --
  -- THE TWO WINDOW COLUMNS AND NOTHING ELSE — load-bearing, not lucky. All three
  -- fund_editions guards are column-scoped, and none of them names these two:
  --   fund_editions_ballot_open         before update OF phase   (20260815090015)
  --   fund_editions_freeze_declarations when split_pct / cost_fee_statement /
  --                                     equity_declared changes  (20260815155811, D16)
  --   fund_editions_freeze_announcement when confirmed_pool_cents /
  --                                     winner_confirmed_at changes (20260815183252)
  -- So this UPDATE is legal by construction. Widening the SET list to phase, or to any
  -- D16 declaration, fires a guard and aborts the whole refresh transaction.
  update public.fund_editions
     set voting_starts_at = now() - interval '7 days',
         voting_ends_at   = now() + interval '23 days'
   where id = md5('fundedition:2027')::uuid
     -- Only while the cycle is still on the ballot: a tester who walked it into
     -- announcement or realization did real testing, and re-opening the window
     -- underneath them would fight the hand it is meant to serve.
     and phase = 'voting'
     and (voting_starts_at is null
          or voting_ends_at is null
          or voting_ends_at < now() + interval '7 days');
  get diagnostics v_ballot = row_count;

  -- §12 The Momenti deck: every persona holds 3 pending cards, scored exactly the way
  -- the matcher scores (visibility-masked tag overlap, affinity >= 2, blocks honored),
  -- so the card's read-time affinity terms render real chips. DELETE+INSERT because
  -- the status guard forbids leaving 'passed'/'accepted', and the pair-unique makes
  -- upsert a no-op. Diff-aware per persona: a persona whose deck already matches gets
  -- ZERO writes, so an untouched world fires no «Hai un Momento» at all — the worst
  -- case is one batch per persona actually being swiped. Deterministic ids keep
  -- notification deep-links valid across re-inserts.
  --
  -- Deliberate consequence: matcher-created persona→tester rows are cleared with the
  -- rest of a dirty persona's deck, and (deck full at 3) not re-proposed — persona
  -- decks are exactly the persona pairs, always. Tester→persona rows are untouched.
  drop table if exists pg_temp._staging_deck;
  -- The persona set is re-derived inline rather than read from v_personas: CREATE
  -- TABLE AS is a utility statement, and plpgsql does not substitute variables there.
  create temp table _staging_deck on commit drop as
  select * from (
    with personas as (
      select pr.id, pr.handle, pr.identity_tags, pr.seeking, pr.visibility
        from public.profiles pr
        join auth.users u on u.id = pr.id
       where u.email like '%@staging.athanor.local'
    ),
    pairs as (
      select r.id as user_id, r.handle as user_handle,
             c.id as candidate_id, c.handle as candidate_handle,
             (coalesce(array_length(athanor.tag_intersect(r.identity_tags, c_tags.v), 1), 0)
              + coalesce(array_length(athanor.tag_intersect(athanor.seeking_to_identity(r.seeking), c_tags.v), 1), 0)
              + coalesce(array_length(athanor.tag_intersect(r.identity_tags, athanor.seeking_to_identity(c_seek.v)), 1), 0))::numeric as affinity
        from personas r
        join personas c on c.id <> r.id
        cross join lateral (select case when coalesce(c.visibility ->> 'identity_tags', 'members') <> 'private'
                                        then c.identity_tags else '{}'::text[] end as v) c_tags
        cross join lateral (select case when coalesce(c.visibility ->> 'seeking', 'members') <> 'private'
                                        then c.seeking else '{}'::text[] end as v) c_seek
       where exists (select 1 from public.dreams d
                      where d.profile_id = c.id and d.status = 'active' and d.deleted_at is null)
         and coalesce(c.visibility ->> 'dream', 'members') <> 'private'
         and athanor.pair_not_blocked(r.id, c.id)
    )
    select user_id, user_handle, candidate_id, candidate_handle, affinity,
           row_number() over (partition by user_id order by affinity desc, candidate_handle)::smallint as rnk
      from pairs
     where affinity >= 2
  ) t
  where t.rnk <= 3;

  select coalesce(array_agg(p.id), '{}'::uuid[]) into v_dirty
    from unnest(v_personas) as p(id)
   where exists (select 1 from public.momento_proposals mp
                  where mp.user_id = p.id and mp.status <> 'pending')
      or exists (select 1 from public.momento_proposals mp
                  where mp.user_id = p.id
                    and not exists (select 1 from pg_temp._staging_deck d
                                     where d.user_id = p.id and d.candidate_id = mp.candidate_id))
      or exists (select 1 from pg_temp._staging_deck d
                  where d.user_id = p.id
                    and not exists (select 1 from public.momento_proposals mp
                                     where mp.user_id = p.id and mp.candidate_id = d.candidate_id
                                       and mp.status = 'pending'));

  if array_length(v_dirty, 1) is not null then
    delete from public.momento_proposals where user_id = any(v_dirty);
    get diagnostics v_deck_deleted = row_count;

    insert into public.momento_proposals (id, user_id, candidate_id, affinity, status, proposed_on, daily_rank)
    select md5('momento:' || d.user_handle || ':' || d.candidate_handle)::uuid,
           d.user_id, d.candidate_id, d.affinity, 'pending', v_today, d.rnk
      from pg_temp._staging_deck d
     where d.user_id = any(v_dirty)
    on conflict do nothing;
    get diagnostics v_deck_inserted = row_count;
  end if;

  -- §13 Notification-noise cap. The «Hai un Momento» fan-out writes AFTER this
  -- transaction commits (trigger → pg_net → edge fn), so the just-created rows can
  -- only be pruned on the NEXT run: persona 'moment' notifications older than 2 hours
  -- go. Tester notifications and the action-gated types are never touched.
  -- 'eventReminder' joins 'moment' here for the same reason and one of its own: §10b
  -- re-arms the reminder every hour on purpose, so without this cap a persona's centre
  -- would accumulate one identical reminder per hour forever.
  delete from public.notifications n
   where n.recipient_id = any(v_personas)
     and n.type in ('moment', 'eventReminder')
     and n.created_at < now() - interval '2 hours';
  get diagnostics v_notifs = row_count;

  return jsonb_build_object(
    'dreams_restored',        v_dreams,
    'content_undeleted',      v_content,
    'milestones_reset',       v_milestones,
    'helps_reset',            v_helps,
    'connection_reqs_reset',  v_creqs,
    'rsvps_reset',            v_rsvps,
    'moderation_cleared',     v_moderation,
    'stories_revived',        v_stories,
    'events_restamped',       v_events,
    'ballot_restamped',       v_ballot,
    'deck_rows_deleted',      v_deck_deleted,
    'deck_rows_inserted',     v_deck_inserted,
    'reminder_marks_cleared', v_reminders,
    'moment_notifs_pruned',   v_notifs
  );
end;
$$;

revoke all on function public.staging_refresh_world() from public, anon, authenticated;
grant execute on function public.staging_refresh_world() to service_role;

-- ---------------------------------------------------------------------------------
-- Schedule. Minute :07 — clear of push-receipt-sweep (:23, the only other hourly
-- job), and at 03:07 the refresh lands BEFORE the matcher/expiry (03:11) and the
-- story prune (03:17). Re-runnable: unschedule-if-present, then schedule.
-- ---------------------------------------------------------------------------------
create extension if not exists pg_cron;

select cron.unschedule(jobid) from cron.job where jobname = 'staging-refresh-world';
select cron.schedule('staging-refresh-world', '7 * * * *', $$ select public.staging_refresh_world() $$);

commit;

-- First refresh now, plus the roster to eyeball. `cron.job_run_details` keeps the
-- jsonb summary of every scheduled run in return_message.
select public.staging_refresh_world() as first_run;
select jobname, schedule, active from cron.job order by jobname;
