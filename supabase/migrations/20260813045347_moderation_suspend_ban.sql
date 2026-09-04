-- #106 — suspend and ban exist now (PRD §4.13: dismiss, warn, score penalty, suspend, ban).
--
-- Two enforcement halves, both server-written only (clients hold no grant on either column):
--
--   1. DB half (this file): profiles.suspended_until / profiles.banned_at, read by
--      athanor.is_active(), composed as RESTRICTIVE write policies over the social surface.
--      Immediate — the next PostgREST statement is denied, no JWT refresh involved.
--   2. Auth half: resolve_report enqueues to the moderation-enforce edge function (pg_net,
--      same guarded-no-op shape as enqueue_score_award), which sets GoTrue ban_duration.
--      That closes sign-in, refresh and every requireUser edge function; it lags the Data
--      API by up to the JWT expiry, which is exactly the window half 1 closes.
--
-- Lift semantics: a suspension expires by itself — is_active() compares suspended_until to
-- now(), and GoTrue's IsBanned() does the same with banned_until, so no sweeper exists on
-- purpose. A ban is permanent (banned_at is a fact, not a timer); undoing a mistaken ban is
-- a deliberate operator action — clear profiles.banned_at AND set GoTrue ban_duration
-- 'none' — not a product flow.
--
-- Deliberately NOT gated (safety, legal, plumbing): blocks, reports (a suspended member can
-- still protect themselves and others), consent, gdpr_export_jobs, gdpr_erasure_requests
-- (GDPR rights are not conditional on standing), notifications, notification_preferences,
-- push_tokens, email_waitlist, profiles INSERT (signup trigger path), event_tickets (writes
-- are grant-denied to authenticated; the claim RPC below is the guarded door), and
-- release_event_seat (cleanup of the caller's own pending claim — blocking it strands a
-- seat for 35 minutes and protects nobody).
--
-- Voting (candidacy_votes) IS gated: cast_vote is SECURITY INVOKER, so the restrictive
-- policy applies. A sanctioned member does not act in the community while sanctioned; the
-- carve-outs above are safety/legal only.

-- ── 1. state on profiles — server-written only ───────────────────────────────────────────
alter table public.profiles
  add column suspended_until timestamptz,
  add column banned_at timestamptz;

comment on column public.profiles.suspended_until is
  'Moderation suspension end (#106). Written only by resolve_report (DEFINER); no client grant in either direction. Self-lifting: athanor.is_active() compares against now(). NULL or past = not suspended.';
comment on column public.profiles.banned_at is
  'Moderation ban timestamp (#106). Written only by resolve_report (DEFINER); no client grant. Permanent — lifting is an operator action (clear this AND GoTrue ban_duration ''none''), not a product flow.';

-- No `grant select/update (…)` for these columns: profiles grants are column-scoped
-- (20260807170813 / 20260811074859), so an ungranted column is unreadable and unwritable
-- from any client. The realtime publication carries an explicit column list (20260811084600)
-- that does not include them, so nothing leaks there either.

-- ── 2. the predicate ─────────────────────────────────────────────────────────────────────
-- SECURITY DEFINER because the two columns deliberately carry no client SELECT grant.
-- Wrapped-initplan discipline applies at every call site: (select athanor.is_active()).
-- No live profile row ⇒ false — which makes a half-erased user (erasure-job runs between
-- sign-out and cascade) fail closed for free.
create or replace function athanor.is_active()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select p.banned_at is null
        and (p.suspended_until is null or p.suspended_until <= now())
       from public.profiles p
      where p.id = (select auth.uid())),
    false);
$$;

comment on function athanor.is_active() is
  'Not banned, not currently suspended (#106). DEFINER: suspended_until/banned_at have no client grant. Composed as restrictive write policies; also the guard inside user-callable DEFINER write RPCs, which RLS cannot reach.';

revoke execute on function athanor.is_active() from public, anon;
grant execute on function athanor.is_active() to authenticated;

-- ── 3. restrictive write policies over the social surface ────────────────────────────────
-- Permissive policies OR together; a RESTRICTIVE policy ANDs on top of every one of them,
-- so nothing existing is dropped or recomposed and a later permissive policy on these
-- tables is gated automatically. Three per table (Postgres has no ALL-minus-SELECT):
-- reads stay open on purpose — suspended ≠ erased, and the read path stays at zero cost.
-- Tables where a command has no permissive policy just carry a moot restriction.
-- (candidacy_videos is a storage BUCKET, not a table — its uploads are gated by the
-- storage.objects policies below.)
-- pgTAP 0091 asserts this exact list, so a new social table missing its three policies
-- fails CI rather than shipping ungated.
do $$
declare
  t text;
begin
  foreach t in array array[
    'posts', 'post_comments', 'post_reactions', 'post_media',
    'story_segments', 'story_reactions',
    'messages', 'conversations',
    'moments', 'projects',
    'dreams', 'dream_milestones', 'milestone_helps', 'favor_offers',
    'events', 'event_attendance', 'rsvps',
    'connection_requests', 'momento_proposals',
    'athanor_days_interest',
    'dream_candidacies', 'candidacy_votes'
  ] loop
    execute format(
      'create policy active_write_insert on public.%I as restrictive for insert
         to authenticated with check ((select athanor.is_active()))', t);
    execute format(
      'create policy active_write_update on public.%I as restrictive for update
         to authenticated using ((select athanor.is_active()))
         with check ((select athanor.is_active()))', t);
    execute format(
      'create policy active_write_delete on public.%I as restrictive for delete
         to authenticated using ((select athanor.is_active()))', t);
  end loop;
end $$;

-- profiles: UPDATE only. INSERT stays open (handle_new_user / first-session path), DELETE
-- has no permissive policy and erasure is the GDPR pipeline's job, which must keep working.
create policy active_write_update on public.profiles
  as restrictive for update
  to authenticated
  using ((select athanor.is_active()))
  with check ((select athanor.is_active()));

-- storage.objects: one restrictive policy per write command gates every bucket at once
-- (avatars, post-media, moments, story-segments — and any future bucket). CREATE POLICY on
-- storage.objects is permitted to postgres; only ALTER TABLE needs ownership (see
-- MIGRATIONS-ERRATA on 20260617155346).
create policy active_write_insert on storage.objects
  as restrictive for insert
  to authenticated with check ((select athanor.is_active()));
create policy active_write_update on storage.objects
  as restrictive for update
  to authenticated
  using ((select athanor.is_active()))
  with check ((select athanor.is_active()));
create policy active_write_delete on storage.objects
  as restrictive for delete
  to authenticated using ((select athanor.is_active()));

-- ── 4. guard the user-callable DEFINER write RPCs ────────────────────────────────────────
-- RLS never reaches a DEFINER body, so the three content-creating RPCs a signed-in client
-- can call directly get the predicate inline. cast_vote and confirm_milestone_help are
-- SECURITY INVOKER — the restrictive policies above already gate them.

-- claim_event_seat — body of 20260812225214 with the guard added after the auth check.
create or replace function public.claim_event_seat(p_event_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_capacity integer;
  v_taken bigint;
begin
  if v_uid is null then
    raise exception 'claim_event_seat: not authenticated';
  end if;
  if not athanor.is_active() then
    raise exception 'claim_event_seat: account suspended or banned' using errcode = '42501';
  end if;

  -- The events row is the arbiter: concurrent claims for one event queue here.
  select capacity into v_capacity
  from public.events
  where id = p_event_id and deleted_at is null
  for update;
  if not found then
    return 'not_found';
  end if;

  if v_capacity is not null then
    select count(*) into v_taken
    from public.event_tickets
    where event_id = p_event_id
      and user_id <> v_uid  -- the caller's own row is replaced below, never double-counted
      and (status in ('paid', 'checked_in')
           or (status = 'pending' and expires_at > now()));
    if v_taken >= v_capacity then
      return 'sold_out';
    end if;
  end if;

  -- One row per (user, event): a fresh claim, a re-claim of an abandoned/expired one, and a
  -- re-buy after a refund all land on the same row. paid/checked_in rows are untouchable —
  -- the edge function refuses them first ('ticket already owned'), and the WHERE below is
  -- the fail-closed belt when it didn't.
  insert into public.event_tickets (user_id, event_id, status, expires_at)
  values (v_uid, p_event_id, 'pending', now() + interval '35 minutes')
  on conflict (user_id, event_id) do update
    set status = 'pending',
        expires_at = excluded.expires_at,
        stripe_payment_id = null,
        qr_token = null
    where event_tickets.status in ('pending', 'refunded');
  if not found then
    return 'already_owned';
  end if;
  return 'claimed';
end;
$$;

-- get_or_create_conversation — body of 20260616123408 with the guard added.
create or replace function public.get_or_create_conversation(peer_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare me uuid := (select auth.uid());
begin
  if me is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  if not athanor.is_active() then
    raise exception 'account suspended or banned' using errcode = '42501';
  end if;
  if peer_id = me then
    raise exception 'cannot open a conversation with oneself' using errcode = 'check_violation';
  end if;
  return public.create_conversation_pair(me, peer_id, 'direct');
end; $$;

-- accept_momento — body of 20260616123408 with the guard added.
create or replace function public.accept_momento(p_proposal_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me uuid := (select auth.uid());
  v_candidate uuid;
  v_status public.momento_status;
  v_matched boolean := false;
  v_conversation_id uuid := null;
begin
  if me is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  if not athanor.is_active() then
    raise exception 'account suspended or banned' using errcode = '42501';
  end if;
  select candidate_id, status into v_candidate, v_status
    from public.momento_proposals where id = p_proposal_id and user_id = me for update;
  if not found then raise exception 'proposal not found' using errcode = 'no_data_found'; end if;
  if v_status <> 'pending' then
    raise exception 'momento already %', v_status using errcode = 'check_violation';
  end if;
  update public.momento_proposals set status = 'accepted' where id = p_proposal_id;
  select exists (
    select 1 from public.momento_proposals p
     where p.user_id = v_candidate and p.candidate_id = me and p.status = 'accepted'
  ) into v_matched;
  if v_matched then
    v_conversation_id := public.create_conversation_pair(me, v_candidate, 'momento');
  end if;
  return jsonb_build_object('matched', v_matched, 'conversation_id', v_conversation_id);
end; $$;

-- ── 5. guarded enqueue to moderation-enforce (mirrors enqueue_score_award) ───────────────
-- Vault secrets app.settings.moderation_enforce_url / _key per project; unconfigured → no-op
-- so the verdict never blocks. If the auth half is down, the DB half above still holds.
create or replace function athanor.enqueue_moderation_enforce(
  p_profile uuid, p_action text, p_until timestamptz
) returns void language plpgsql security definer set search_path = '' as $$
declare
  v_url text := athanor.runtime_setting('moderation_enforce_url');
  v_key text := athanor.runtime_setting('moderation_enforce_key');
begin
  if v_url is null or v_url = '' or v_key is null or v_key = '' then
    return; -- enforce fn not configured (pre-deploy) → no-op, never block the verdict
  end if;
  perform net.http_post(
    url := v_url,
    -- athanor.edge_auth_headers, never a hand-built Authorization bearer: a new-style
    -- sb_secret_… key is not a JWT and the platform rejects it when sent as one.
    headers := athanor.edge_auth_headers(v_key),
    body := jsonb_build_object(
      'profileId', p_profile,
      'action', p_action,
      'until', case when p_until is null then null
                    else to_char(p_until at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') end)
  );
end; $$;
revoke execute on function athanor.enqueue_moderation_enforce(uuid, text, timestamptz)
  from public, anon, authenticated;

-- ── 6. resolve_report v3 — the five PRD actions ──────────────────────────────────────────
-- DROP, not overload: a second signature makes omitted args ambiguous to PostgREST
-- (PGRST203 — the NOTE in packages/api/src/admin.ts).
drop function public.resolve_report(uuid, text, text, text, text, integer);

create function public.resolve_report(
  p_report_id uuid, p_status text, p_resolution text,
  p_action text, p_severity text default null, p_penalty_points integer default null,
  p_suspend_until timestamptz default null
) returns void language plpgsql security definer set search_path = '' as $$
declare v_target uuid; v_ttype text; v_rows int;
begin
  if not athanor.is_admin() then raise exception 'not authorized' using errcode = '42501'; end if;
  -- 'reviewing' left the valid set: no caller ever sent it (packages/api/src/admin.ts maps
  -- dismiss→dismissed, everything else→upheld) and a verdict RPC that can park a report in
  -- limbo is a bug surface, not a feature.
  if p_action not in ('dismiss', 'warn', 'penalty', 'suspend', 'ban') then
    raise exception 'bad action' using errcode = '22023';
  end if;
  if (p_action = 'dismiss') <> (p_status = 'dismissed') or p_status not in ('dismissed', 'upheld') then
    raise exception 'action/status mismatch' using errcode = '22023';
  end if;
  -- penalty_points is the record of a penalty; on any other action a value would assert an
  -- Aura deduction that never happened.
  if p_action <> 'penalty' and p_penalty_points is not null then
    raise exception 'penalty_points requires action penalty' using errcode = '22023';
  end if;
  if p_action = 'suspend' and (p_suspend_until is null or p_suspend_until <= now()) then
    raise exception 'suspend requires a future p_suspend_until' using errcode = '22023';
  end if;

  update public.reports
     set status = p_status, resolution = p_resolution,
         reviewed_by = (select auth.uid()), updated_at = now()
   where id = p_report_id and status in ('open', 'reviewing')
   returning target_id, target_type into v_target, v_ttype;
  get diagnostics v_rows = row_count;
  if v_rows = 0 then return; end if; -- already resolved or missing → no-op (idempotent guard)

  insert into public.audit_log (report_id, actor_id, action, penalty_points, reason)
    values (p_report_id, (select auth.uid()), p_action, p_penalty_points, p_resolution);

  if p_action in ('penalty', 'suspend', 'ban') then
    if v_ttype <> 'person' or v_target is null then
      raise exception '% verdict requires a person target', p_action using errcode = '22023';
    end if;
  end if;

  if p_action = 'penalty' then
    -- severity comes from the caller (computed in @athanor/core), never reverse-mapped in SQL.
    perform athanor.enqueue_score_award(v_target, 'report_upheld', p_report_id, p_severity);
  elsif p_action = 'suspend' then
    -- greatest(): a new verdict can extend a running suspension, never shorten it.
    update public.profiles
       set suspended_until = greatest(coalesce(suspended_until, p_suspend_until), p_suspend_until),
           updated_at = now()
     where id = v_target;
    perform athanor.enqueue_moderation_enforce(v_target, 'suspend', p_suspend_until);
  elsif p_action = 'ban' then
    update public.profiles
       set banned_at = coalesce(banned_at, now()), -- idempotent: the first ban date is the fact
           updated_at = now()
     where id = v_target;
    perform athanor.enqueue_moderation_enforce(v_target, 'ban', null);
  end if;
  -- 'warn' and 'dismiss': the audit row above IS the outcome. A warning the member actually
  -- sees (notification) is a follow-up — the fan-out template does not exist yet.
end; $$;

comment on function public.resolve_report(uuid, text, text, text, text, integer, timestamptz) is
  'Moderation verdict (#106): dismiss | warn | penalty | suspend | ban (PRD §4.13). DEFINER, re-checks is_admin. penalty → enqueue_score_award (rule #1: the engine writes Aura, never this). suspend/ban → profiles state (RLS half) + enqueue_moderation_enforce (GoTrue half). Zero aura_events written here.';

revoke execute on function public.resolve_report(uuid, text, text, text, text, integer, timestamptz)
  from public, anon;
grant execute on function public.resolve_report(uuid, text, text, text, text, integer, timestamptz)
  to authenticated;
