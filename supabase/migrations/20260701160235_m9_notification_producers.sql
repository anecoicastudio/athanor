-- M9 notification-fan-out DB producers — notification-fan-out (20260620…) is the SOLE writer
-- of public.notifications, but until this migration NO trigger ever invoked it, so the in-app
-- center rendered the honest empty state (docs/superpowers/T0-parallel-tasks.md task A2).
--
-- Mirrors the guarded-enqueue pattern already shipped twice (public.enqueue_push, 20260617083714;
-- athanor.enqueue_score_award, 20260701124122): a SECURITY DEFINER fn that no-ops until
-- app.settings.notification_fanout_url / _key are set (deploy-time, task E1), so every trigger
-- below is inert pre-deploy and NEVER blocks the source insert/update.
--
-- Invocation contract (read from supabase/functions/notification-fan-out/index.ts): POST
-- { recipient_id, type, template_key, params?, entity_ref? } with `Authorization: Bearer
-- <service-role key>` (fan-out asserts bearer === SUPABASE_SERVICE_ROLE_KEY, 401 otherwise — the
-- same "service-role only" gate as push-dispatch/score-engine, so notification_fanout_key at
-- deploy time MUST be the service-role key, not a fresh secret). `type` must be one of the
-- notifications.type check-constraint values (20260620025158); `entity_ref` must be
-- `{"kind": text, "id": text}` or omitted — packages/schemas/src/notification.ts's
-- entityRefSchema is the client-side contract for that shape.
--
-- Producer decisions (candidates from the task: milestone_helps, post_reactions, events,
-- momento_proposals, connection_requests, fund_aggregates):
--   WIRED   milestone_helps  INSERT (status='offered')      → notif.tpl.dreamMilestone (owner)
--   WIRED   connection_requests INSERT (status='pending')   → notif.tpl.connection (addressee)
--   WIRED   connection_requests UPDATE (->accepted)         → notif.tpl.connectionAccepted (requester)
--   WIRED   momento_proposals INSERT                        → notif.tpl.moment (recipient) — see below
--   SKIPPED connection_requests UPDATE (->declined) — deliberately NOT notified: Inv 7 privacy
--           (documented in 20260616153035_connection_requests.sql) makes a decline
--           indistinguishable from a withdrawal, so surfacing "X declined you" would leak that
--           distinction; the requester simply sees the request drop out of their pending view.
--   SKIPPED milestone_helps "confirm" (accepted->completed) — no template: the only
--           dreamMilestone template body ("ha offerto come mentor…") narrates an OFFER, not a
--           completion; reusing it here would show the wrong copy to the wrong party. Needs a
--           new notif.tpl.helpConfirmed before this can wire (fan-out edge-fn change, own slice).
--   SKIPPED post_reactions — no template represents a ✦ reaction; the only body containing
--           "review"-shaped language (notif.tpl.review, "ti ha lasciato una recensione") belongs
--           to a distinct not-yet-built reviews feature, not post_reactions. Also in the spirit
--           of rule #3 (reaction counts are author-only, never amplified) a per-reaction push
--           would be noisy; author-facing awareness already exists via post_reaction_count().
--   SKIPPED events — notif.tpl.eventReminder ("è tra poco… N partecipano") is a pre-event-start
--           reminder, not an on-create signal; an AFTER INSERT trigger fires the moment an event
--           is authored (often days/weeks out) and has no attendee count yet. Needs a scheduled
--           job (pg_cron) reading events.starts_at, not a row trigger — own slice.
--   SKIPPED fund_aggregates — notif.tpl.fundMilestone has no single recipient (it is a
--           fund-wide broadcast: "the fund passed €X"); enqueue_notification's contract is
--           one-recipient-per-call, and fund_aggregates has no bounded/opt-in audience column to
--           iterate cheaply. Broadcasting to every profile from a per-row AFTER trigger is a
--           different mechanism (fan-out-to-many) that doesn't exist yet — own slice.
--
--   CONSOLIDATED (not a new trigger) momento_proposals already has a push-only producer
--   (public.on_momento_proposal_push, 20260617083714/20260617085320) that calls
--   public.enqueue_push directly, bypassing the in-app notifications row entirely — the exact
--   bug this task fixes, just for a different table. Adding a SECOND trigger that also calls
--   fan-out (which itself dispatches push, 20260620…/index.ts) would double-push once both
--   push_dispatch_url/_key AND notification_fanout_url/_key are configured at deploy. Instead,
--   this migration replaces on_momento_proposal_push's BODY (create or replace — same function
--   name/schema, so the existing trigger binding and pgTAP 0034 (trigger_is checks) are
--   untouched) to call athanor.enqueue_notification, which now owns BOTH the in-app row and the
--   push dispatch for this table, matching the "fan-out is the sole writer" architecture.

-- ── athanor.enqueue_notification: guarded POST to notification-fan-out ─────────────────────
create or replace function athanor.enqueue_notification(
  p_recipient uuid,
  p_type text,
  p_template_key text,
  p_params jsonb,
  p_entity_ref jsonb
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url text := current_setting('app.settings.notification_fanout_url', true);
  v_key text := current_setting('app.settings.notification_fanout_key', true);
begin
  if v_url is null or v_url = '' or v_key is null or v_key = '' then
    return; -- fan-out not configured (pre-deploy) → no-op, never block the source write
  end if;
  perform net.http_post(
    url := v_url,
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_key),
    body := jsonb_build_object(
      'recipient_id', p_recipient,
      'type', p_type,
      'template_key', p_template_key,
      'params', coalesce(p_params, '{}'::jsonb),
      'entity_ref', p_entity_ref
    )
  );
end;
$$;
revoke execute on function athanor.enqueue_notification(uuid, text, text, jsonb, jsonb)
  from public, anon, authenticated;

-- ── 1. milestone_helps: a helper's offer notifies the dream owner ──────────────────────────
create or replace function athanor.notify_milestone_help_offer() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_owner uuid;
  v_helper_handle text;
begin
  select d.profile_id into v_owner
    from public.dream_milestones m
    join public.dreams d on d.id = m.dream_id
   where m.id = new.milestone_id;
  if v_owner is null or v_owner = new.helper_id then
    return new; -- missing milestone (shouldn't happen, FK) or self-help (RLS already forbids it)
  end if;
  select handle into v_helper_handle from public.profiles where id = new.helper_id;
  perform athanor.enqueue_notification(
    v_owner, 'dreamMilestone', 'notif.tpl.dreamMilestone',
    jsonb_build_object('name', coalesce(v_helper_handle, '')),
    jsonb_build_object('kind', 'milestone_help', 'id', new.id::text)
  );
  return new;
end; $$;
revoke execute on function athanor.notify_milestone_help_offer() from public, anon, authenticated;

create trigger milestone_helps_notify_offer
  after insert on public.milestone_helps
  for each row execute function athanor.notify_milestone_help_offer();

-- ── 2. connection_requests: a new request notifies the addressee ───────────────────────────
create or replace function athanor.notify_connection_request() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_requester_handle text;
begin
  select handle into v_requester_handle from public.profiles where id = new.requester_id;
  perform athanor.enqueue_notification(
    new.addressee_id, 'connection', 'notif.tpl.connection',
    jsonb_build_object('name', coalesce(v_requester_handle, '')),
    jsonb_build_object('kind', 'connection_request', 'id', new.id::text)
  );
  return new;
end; $$;
revoke execute on function athanor.notify_connection_request() from public, anon, authenticated;

create trigger connection_requests_notify_insert
  after insert on public.connection_requests
  for each row execute function athanor.notify_connection_request();

-- ── 3. connection_requests: acceptance notifies the original requester ─────────────────────
create or replace function athanor.notify_connection_accepted() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_addressee_handle text;
begin
  if new.status = 'accepted' and old.status is distinct from 'accepted' then
    select handle into v_addressee_handle from public.profiles where id = new.addressee_id;
    perform athanor.enqueue_notification(
      new.requester_id, 'connection', 'notif.tpl.connectionAccepted',
      jsonb_build_object('name', coalesce(v_addressee_handle, '')),
      jsonb_build_object('kind', 'connection', 'id', new.id::text)
    );
  end if;
  return new;
end; $$;
revoke execute on function athanor.notify_connection_accepted() from public, anon, authenticated;

-- This AFTER-UPDATE trigger shares its event with the pre-existing connection_requests_on_accepted
-- (20260616153035 — projects into `connections` + opens a conversation via on_connection_accepted()).
-- Postgres fires same-timing triggers in trigger-NAME order, so this one (…notify_accepted, 'n')
-- runs before …on_accepted ('o') — but the two are intentionally ORDER-INDEPENDENT: this trigger
-- only reads new/old + profiles.handle and enqueues, while on_accepted writes unrelated tables;
-- neither observes the other's side effects. Do not add a cross-dependency here without making
-- the ordering explicit.
create trigger connection_requests_notify_accepted
  after update on public.connection_requests
  for each row execute function athanor.notify_connection_accepted();

-- ── 4. momento_proposals: consolidate the existing push-only producer onto fan-out ─────────
-- Same function name/schema as 20260617085320 (create or replace) — the trigger binding
-- (momento_proposals_push → public.on_momento_proposal_push, asserted by pgTAP 0034) is
-- untouched; only the body changes, from a direct public.enqueue_push (push transport only) to
-- athanor.enqueue_notification (in-app row + push, single call — no more double-push risk).
create or replace function public.on_momento_proposal_push() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_candidate_handle text;
begin
  select handle into v_candidate_handle from public.profiles where id = new.candidate_id;
  perform athanor.enqueue_notification(
    new.user_id, 'moment', 'notif.tpl.moment',
    jsonb_build_object('name', coalesce(v_candidate_handle, '')),
    jsonb_build_object('kind', 'momento', 'id', new.id::text)
  );
  return new;
end;
$$;
revoke execute on function public.on_momento_proposal_push() from public, anon, authenticated;
