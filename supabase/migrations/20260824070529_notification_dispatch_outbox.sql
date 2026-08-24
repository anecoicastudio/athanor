-- Notification dispatch reliability (#521): an outbox + a reconciler, and a minted dedupe key
-- so the retry the reconciler performs is exactly-once rather than a second «Hai un Momento».
--
-- ── The defect ───────────────────────────────────────────────────────────────────────────────
--
-- athanor.enqueue_notification `perform net.http_post(...)` — fire and forget. It returns before
-- any response exists and throws away the request id, so when notification-fan-out answers 5xx
-- the notification row is never written and nothing anywhere records that it was not. Observed
-- live on staging during PR #520: of four enqueues in one sweep, three returned 200 {"ok":true}
-- and one returned 500 {"error":"notification insert failed: JWT issued at future"} — transient
-- clock skew. That attendee's reminder was lost, and public.event_reminder_sweep() had already
-- committed the (event, attendee, slot) marker, because pg_net gives it nothing to wait for.
-- Re-arming the marker by hand and re-sweeping delivered it with no code change: the failure was
-- transient, the loss was not.
--
-- ── What #127 already delivered, and what it did not ─────────────────────────────────────────
--
-- 20260823121933 / 20260823124203 added public.notifications.dedupe_key and its unique index,
-- and 20260823121934 made the two BROADCAST producers pass one. That is #521's second scope
-- bullet, for the broadcast path only. The nine single-recipient producers
-- (notify_milestone_help_offer, notify_connection_request, notify_connection_accepted,
-- on_momento_proposal_push, notify_milestone_help_accepted, notify_milestone_help_completed,
-- resolve_report's warn, notify_gdpr_export_ready, event_reminder_sweep) still write no key,
-- and NOTHING in the tree has ever read net._http_response. So no retry existed on either path.
--
-- ── The two halves, and why both ─────────────────────────────────────────────────────────────
--
-- 1. IDEMPOTENCY — enqueue_notification mints the dedupe key itself.
--
--    The obvious reading of "a dedupe key carried from producer to public.notifications" is a
--    new parameter and a stable key invented per producer. That is rejected here on three
--    counts. It changes athanor.enqueue_notification's signature, which supabase/tests/0065 and
--    0076 pin by exact arg list; it asks nine call sites in five migrations to each invent a
--    key; and for several of them there IS no stable key, because «two identical rows are two
--    real events» is a deliberate property (20260823121933:44-46) — two Momenti an hour apart
--    are two Momenti, and any key stable enough to survive a retry would also collapse them.
--
--    A key minted PER CALL settles all three. Each enqueue gets a fresh uuid, so two genuine
--    calls stay two rows exactly as today; the key is stored with the payload, so a RETRY of
--    that one dispatch re-POSTs the identical body and the fan-out's ON CONFLICT DO NOTHING
--    collapses it. Idempotency is a property of the retry, which is the only place it was ever
--    needed, and no producer changes at all.
--
-- 2. RECONCILIATION — the outbox below, swept against net._http_response.
--
--    Idempotency alone makes a retry SAFE; it does not make one HAPPEN. net._http_response is
--    keyed by the id net.http_post returns, which `perform` discarded — so the request id and
--    the payload have to be persisted at enqueue time or the response can never be attributed
--    back to a recipient. (The 500 body is `{"error": "notification insert failed: …"}` and
--    echoes no identity; _shared/respond.ts has nowhere to put one.) Hence a row per dispatch.
--
--    Attribution by id also keeps the sweep off everybody else's traffic: net._http_response is
--    shared with enqueue_push, enqueue_score_award, enqueue_media_process and the four invoke_*
--    wrappers, and a filter by url or content would be guesswork. A join on request_id sees
--    exactly our own rows.
--
-- The producer marker stays claimed BEFORE the POST. With 1+2 an early claim is no longer a
-- loss — the dispatch is retried until it lands — and moving the claim would mean rewriting
-- every sweep to a two-phase protocol for a weaker guarantee (a claim after success still loses
-- the row if the process dies between the two).
--
-- Deliberately NOT widened: the other pg_net callers (enqueue_push, enqueue_score_award,
-- enqueue_media_process, and the invoke_* cron wrappers) share the fire-and-forget property.
-- They are a different failure class — a lost push is already covered by the receipt sweep, a
-- lost score award is replayable from its source row — and #521 is scoped to notifications.

-- ── 1. the outbox ────────────────────────────────────────────────────────────────────────────
-- Full #180 convention (uuid PK, created_at/updated_at + touch trigger): unlike the send
-- markers this row IS revised — every retry rewrites request_id and attempts — so updated_at is
-- maintained and means something.
create table athanor.notification_dispatches (
  id uuid primary key default gen_random_uuid(),
  -- pg_net id of the LATEST attempt. Not unique and not a FK: net._http_response is unlogged
  -- and pruned on pg_net's own TTL, so the id it points at may already be gone.
  request_id bigint not null,
  -- the EXACT body that was POSTed, replayed byte-for-byte on retry. Replaying the stored body
  -- rather than rebuilding it is what makes the dedupe key survive the retry.
  payload jsonb not null,
  attempts smallint not null default 1,
  -- set when the retry budget is spent. A row that reaches this state is the trace #521 says
  -- the loss never leaves: «the loss leaves no trace in any table a human looks at».
  abandoned_at timestamptz,
  last_status integer,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table athanor.notification_dispatches is
  'Outbox for notification-fan-out POSTs (#521). One row per dispatch, carrying the pg_net '
  'request id and the exact body, so athanor.notification_dispatch_reconcile() can read the '
  'response out of net._http_response and re-POST what failed. Delivered rows are deleted on '
  'the next tick; abandoned ones are kept 30 days as the only durable trace of a lost '
  'notification. Lives in `athanor` — off the client grant surface — like the send markers.';

create trigger notification_dispatches_touch_updated_at
  before update on athanor.notification_dispatches
  for each row execute function public.touch_updated_at();

-- The reconciler's only access path: join by request_id, then filter the still-open rows.
create index notification_dispatches_request_id
  on athanor.notification_dispatches (request_id);
-- Partial: the sweep reads only rows still in flight, and the delivered majority never lives
-- long enough to matter. Abandoned rows are reached by the retention delete on created_at.
create index notification_dispatches_open
  on athanor.notification_dispatches (created_at)
  where abandoned_at is null;

-- No policies and no grants, exactly as athanor.event_reminder_sends: `athanor` is not in
-- config.toml's exposed schemas, so PostgREST cannot see this table, and RLS with zero policies
-- is deny-all for anyone who reached it anyway. Since 20260816164834 a new table is born with
-- no client privileges at all, but state it rather than rely on it.
alter table athanor.notification_dispatches enable row level security;
revoke all on table athanor.notification_dispatches from public, anon, authenticated;
grant all on table athanor.notification_dispatches to service_role;

-- ── 2. the producers record what they POST ───────────────────────────────────────────────────
-- Signature unchanged on both — see header §1. Only the body and the bookkeeping move.
CREATE OR REPLACE FUNCTION athanor.enqueue_notification(p_recipient uuid, p_type text, p_template_key text, p_params jsonb, p_entity_ref jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_url  text := athanor.runtime_setting('notification_fanout_url');
  v_key  text := athanor.runtime_setting('notification_fanout_key');
  v_body jsonb;
  v_id   bigint;
begin
  if v_url is null or v_url = '' or v_key is null or v_key = '' then
    return; -- fan-out not configured (pre-deploy) → no-op, never block the source write
  end if;
  -- Minted per CALL, never derived from the arguments: two identical notifications are two real
  -- events and must stay two rows. What this key deduplicates is a retry of THIS dispatch.
  v_body := jsonb_build_object(
    'recipient_id', p_recipient,
    'type', p_type,
    'template_key', p_template_key,
    'params', coalesce(p_params, '{}'::jsonb),
    'entity_ref', p_entity_ref,
    'dedupe_key', gen_random_uuid()::text
  );
  v_id := net.http_post(
    url := v_url,
    headers := athanor.edge_auth_headers(v_key),
    body := v_body
  );
  insert into athanor.notification_dispatches (request_id, payload) values (v_id, v_body);
end;
$function$;

comment on function athanor.enqueue_notification(uuid, text, text, jsonb, jsonb) is
  'Single-recipient producer for notification-fan-out. Mints a per-dispatch dedupe_key and '
  'records the pg_net request id in athanor.notification_dispatches so a failed POST is '
  'retried by athanor.notification_dispatch_reconcile() (#521). Guarded no-op while the '
  'fan-out Vault pair is unset.';

CREATE OR REPLACE FUNCTION athanor.enqueue_audience_notification(p_audience text, p_type text, p_template_key text, p_params jsonb, p_entity_ref jsonb, p_dedupe_key text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_url  text := athanor.runtime_setting('notification_fanout_url');
  v_key  text := athanor.runtime_setting('notification_fanout_key');
  v_body jsonb;
  v_id   bigint;
begin
  if v_url is null or v_url = '' or v_key is null or v_key = '' then
    return; -- fan-out not configured (pre-deploy) → no-op, never block the source write
  end if;
  if p_dedupe_key is null or p_dedupe_key = '' then
    raise exception 'enqueue_audience_notification requires a dedupe_key';
  end if;
  -- The broadcast key is the CALLER's (a stable (edition, kind, slot) string) — it already
  -- makes a re-send safe, so the outbox row only has to supply the retry.
  v_body := jsonb_build_object(
    'audience', p_audience,
    'type', p_type,
    'template_key', p_template_key,
    'params', coalesce(p_params, '{}'::jsonb),
    'entity_ref', p_entity_ref,
    'dedupe_key', p_dedupe_key
  );
  v_id := net.http_post(
    url := v_url,
    headers := athanor.edge_auth_headers(v_key),
    body := v_body
  );
  insert into athanor.notification_dispatches (request_id, payload) values (v_id, v_body);
end;
$function$;

comment on function athanor.enqueue_audience_notification(text, text, text, jsonb, jsonb, text) is
  'Broadcast sibling of athanor.enqueue_notification (#127). POSTs ONE audience request to '
  'notification-fan-out, which resolves the named audience and writes a row per eligible '
  'member. dedupe_key is mandatory: it is what makes a re-send after a 5xx safe. Records the '
  'pg_net request id in athanor.notification_dispatches so a failed POST is retried (#521). '
  'Guarded no-op while the fan-out Vault pair is unset.';

-- ── 3. the reconciler ────────────────────────────────────────────────────────────────────────
create or replace function athanor.notification_dispatch_reconcile() returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- Attempts INCLUDING the original POST. Three is two retries: the observed failure class is a
  -- momentary 5xx, and a body that fails three times a minute apart is not going to succeed on
  -- the fourth — it wants a human, which is what abandoned_at is for.
  c_max_attempts constant smallint := 3;
  -- A dispatch with no response row yet is normally in flight for seconds. Waiting a full
  -- minute before treating silence as failure keeps the sweep off requests pg_net has simply
  -- not got to, and a spurious re-POST would be deduped anyway.
  c_grace        constant interval := interval '1 minute';
  c_retention    constant interval := interval '30 days';
  v_url text;
  v_key text;
  v_d   record;
  v_id  bigint;
begin
  -- Retention first and unconditionally (the lesson of 20260823110358 §2): a reaper that sits
  -- below a configuration guard stops running exactly when a backlog is building.
  delete from athanor.notification_dispatches
   where abandoned_at is not null and abandoned_at < now() - c_retention;

  -- Delivered → the outbox row has done its job. 2xx from fan-out means the notifications row
  -- exists; a swallowed push failure is a 200 by design (see §4 of this migration's edge-side
  -- change) precisely so it is NOT retried here — re-POSTing would re-run an insert that
  -- already succeeded to chase a push the receipt sweep owns.
  delete from athanor.notification_dispatches d
   using net._http_response r
   where r.id = d.request_id
     and r.status_code between 200 and 299;

  v_url := athanor.runtime_setting('notification_fanout_url');
  v_key := athanor.runtime_setting('notification_fanout_key');
  if coalesce(v_url, '') = '' or coalesce(v_key, '') = '' then
    return; -- unconfigured → leave everything pending rather than burn the retry budget
  end if;

  for v_d in
    select d.id,
           d.payload,
           d.attempts,
           r.status_code,
           coalesce(r.error_msg, left(r.content, 500)) as detail
      from athanor.notification_dispatches d
      left join net._http_response r on r.id = d.request_id
     where d.abandoned_at is null
       and d.updated_at < now() - c_grace
       -- Failed, or vanished. `status_code is null` covers both the not-yet-answered row and
       -- the case where pg_net's TTL pruned the response before we looked; after the grace
       -- window both are indistinguishable from a failure, and the dedupe key makes guessing
       -- wrong harmless. coalesce, not a bare NOT BETWEEN: `null not between 200 and 299` is
       -- NULL, so the unqualified form would silently skip every missing response.
       and coalesce(r.status_code, 0) not between 200 and 299
     order by d.created_at
     limit 200                              -- bounded work per tick; the rest waits a minute
  loop
    -- A 4xx is deterministic: the same body will be rejected the same way every time (an
    -- unknown audience, a malformed dedupe_key, a validation miss). Retrying it burns the
    -- budget to reach the same place two minutes later, so it is abandoned on sight — with its
    -- status recorded, which is the point: a 400 in this table names a producer bug.
    if v_d.status_code between 400 and 499 or v_d.attempts >= c_max_attempts then
      update athanor.notification_dispatches
         set abandoned_at = now(),
             last_status  = v_d.status_code,
             last_error   = v_d.detail
       where id = v_d.id;
      raise warning 'notification dispatch abandoned after % attempt(s): % (status %)',
        v_d.attempts, v_d.id, coalesce(v_d.status_code::text, 'none');
    else
      -- The stored body, unmodified: same dedupe_key, so fan-out inserts only what is missing.
      v_id := net.http_post(
        url := v_url,
        headers := athanor.edge_auth_headers(v_key),
        body := v_d.payload
      );
      update athanor.notification_dispatches
         set request_id  = v_id,
             attempts    = attempts + 1,
             last_status = v_d.status_code,
             last_error  = v_d.detail
       where id = v_d.id;
    end if;
  end loop;
end;
$$;

comment on function athanor.notification_dispatch_reconcile() is
  'Reads net._http_response for every open athanor.notification_dispatches row (#521): drops '
  'the 2xx ones, re-POSTs the failed and the vanished with the stored body — same dedupe_key, '
  'so the retry is exactly-once — and marks abandoned_at after 3 attempts, or on sight for a '
  'deterministic 4xx, so a genuinely lost notification leaves a trace. SECURITY DEFINER '
  'because net._http_response is owned by '
  'supabase_admin and readable to postgres, not to any client role. Cron-only.';

-- Not a client API. `athanor` is outside 0121''s function-EXECUTE block (which covers `public`),
-- but the default ACL still grants EXECUTE to PUBLIC/anon/authenticated on a new function —
-- rule 8 and #409. Revoke, like every sibling in this schema.
revoke execute on function athanor.notification_dispatch_reconcile()
  from public, anon, authenticated;

-- ── 4. schedule ──────────────────────────────────────────────────────────────────────────────
create extension if not exists pg_cron;

-- Every minute. pg_net prunes net._http_response on its own TTL (hours), so the sweep only has
-- to run comfortably inside that window — but a lost reminder is time-critical in a way a lost
-- broadcast is not: an event_reminder_sweep t1 dispatch has one hour of usefulness left, and a
-- retry that arrives fifteen minutes late has spent a quarter of it.
select cron.schedule(
  'notification-dispatch-reconcile',
  '* * * * *',
  $$ select athanor.notification_dispatch_reconcile() $$
);
