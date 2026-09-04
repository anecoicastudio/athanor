-- #521 follow-up: a vanished response must not erase the status that caused the retry.
--
-- 20260824070529 (and 20260824071839 after it) assigned `last_status = v_d.status_code` on every
-- retry and on abandonment. That column is NULL whenever the response row is missing — pg_net
-- never answered, or its TTL pruned the row before the sweep looked — so the common two-step
-- failure erased its own evidence: attempt 1 records the 500 that #521 was filed about, attempt 2
-- finds no response, writes NULL over it, and the abandoned row a human eventually reads says
-- nothing about why. The trace is the whole point of abandoned_at; a trace that blanks itself on
-- the second tick is not one.
--
-- coalesce keeps the last status that was actually OBSERVED, in both branches. A dispatch that
-- never got a response at all still shows NULL, which is honest — "no answer" is the finding.
--
-- Fixed by replacement rather than by editing either predecessor, both of which are already
-- applied to staging (rule 7, append-only). Only the two UPDATE column lists change.

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
    -- 400 is the ONE deterministic rejection: it is the only 4xx notification-fan-out itself
    -- emits ('missing fields', 'unknown audience'), and the same body will be rejected the same
    -- way every time, so retrying it burns the budget to reach the same place two minutes
    -- later. It is abandoned on sight with its status recorded, which is the point: a 400 in
    -- this table names a producer bug.
    --
    -- Every OTHER 4xx is the platform, not the body, and is exactly what the outbox is for: 401
    -- while the fan-out key is mid-rotation, 404 before the function is deployed or on a
    -- cold-start miss, 403, 429. Abandoning those would throw away every pending notification
    -- on the first sweep of precisely the outage this exists to survive.
    if v_d.status_code = 400 or v_d.attempts >= c_max_attempts then
      update athanor.notification_dispatches
         set abandoned_at = now(),
             last_status  = coalesce(v_d.status_code, last_status),
             last_error   = coalesce(v_d.detail, last_error)
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
             -- coalesce, not assignment: a VANISHED response has no status, and overwriting a
             -- recorded 500 with NULL would erase the only evidence of why this dispatch is
             -- being retried at all. Keep the last status that was actually observed.
             last_status = coalesce(v_d.status_code, last_status),
             last_error  = coalesce(v_d.detail, last_error)
       where id = v_d.id;
    end if;
  end loop;
end;
$$;

comment on function athanor.notification_dispatch_reconcile() is
  'Reads net._http_response for every open athanor.notification_dispatches row (#521): drops '
  'the 2xx ones, re-POSTs the failed and the vanished with the stored body — same dedupe_key, '
  'so the retry is exactly-once — and marks abandoned_at after 3 attempts, or on sight for a '
  '400 (the one deterministic rejection), so a genuinely lost notification leaves a trace. '
  'A 401/403/404/429 is the platform rather than the body and takes the full retry budget. '
  'SECURITY DEFINER '
  'because net._http_response is owned by '
  'supabase_admin and readable to postgres, not to any client role. Cron-only.';

-- Not a client API. `athanor` is outside 0121''s function-EXECUTE block (which covers `public`),
-- but the default ACL still grants EXECUTE to PUBLIC/anon/authenticated on a new function —
-- rule 8 and #409. Revoke, like every sibling in this schema.
revoke execute on function athanor.notification_dispatch_reconcile()
  from public, anon, authenticated;

