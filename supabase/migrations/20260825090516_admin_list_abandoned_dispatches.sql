-- The read side of the notification dispatch outbox (#534).
--
-- #521 gave a lost notification a durable trace: when a dispatch exhausts its retry budget the
-- row keeps `abandoned_at`, `last_status` and `last_error` for 30 days. Nothing read any of it.
-- A repo-wide grep for those three columns returned only the migrations, the pgTAP file, two
-- catalog rows and one comment — no query, no panel, no alert. The only runtime signal was a
-- `raise warning` into the Postgres log, and then the row deleted itself.
--
-- That is worse than an obvious gap, because it reads as done: the next audit finds
-- `abandoned_at` in the schema and a test asserting it gets set, and concludes lost
-- notifications are surfaced. They were not.
--
-- ── Why an RPC and not a view ──────────────────────────────────────────────────────────────
--
-- `athanor` is not in config.toml's `schemas = ["public", "graphql_public"]`, so PostgREST
-- cannot see the table at all and no amount of grants would make a direct select work. A
-- SECURITY DEFINER function in `public` is the only read path, exactly as `admin_list_waitlist`
-- (20260821085655) is for `email_waitlist`. This follows that shape deliberately, down to the
-- cursor: keyset, both halves or neither, `p_limit` clamped inside.
--
-- ── The keyset lives INSIDE the function ───────────────────────────────────────────────────
--
-- Rule 9 is cursor pagination, never offset, and the predicate cannot sit in a PostgREST filter
-- when the client cannot reach the table. Cursor = the last row's (created_at, id), ordered
-- `created_at desc, id desc`. `id` is the tie-break: a keyset without one skips or repeats a
-- row whenever two dispatches share a timestamp, and these are written in bursts by a
-- once-a-minute reconciler, so ties are the normal case rather than the exotic one.
--
-- A half cursor raises 22023 rather than silently restarting at page 1 — the stance
-- `admin_list_waitlist` and `getReportQueue` both take.
--
-- ── What it does NOT return ────────────────────────────────────────────────────────────────
--
-- `payload` is excluded. It is the exact notification body that was POSTed, replayed
-- byte-for-byte on retry, so it carries member-facing content; the question this surface
-- answers is "did we lose notifications, and why", which needs the status and the error, not
-- the message. `last_error` is `error_msg` or the first 500 chars of the response body
-- (20260824072554), so it can carry whatever the callee returned — admin-only is the right
-- audience for it and the reason this is gated rather than merely unexposed.
--
-- ── Grants ─────────────────────────────────────────────────────────────────────────────────
--
-- Same posture as the waitlist RPCs: EXECUTE revoked from public + anon, granted to
-- authenticated, `athanor.is_admin()` re-checked INSIDE so the grant is not the authorization.
-- No 0121 row is owed: that file pins anon's and PUBLIC's executable surface BY NAME and
-- one-directionally, so a function that revokes from both simply never joins those lists —
-- and would make 0121 red if the revoke were forgotten, which is the point.
--
-- No aura path (rule 1). Read-only: `stable`, and it writes nothing.

create function public.admin_list_abandoned_dispatches(
  p_limit integer default 25,
  p_before_created_at timestamptz default null,
  p_before_id uuid default null
)
  returns table (
    id uuid,
    request_id bigint,
    attempts smallint,
    last_status integer,
    last_error text,
    abandoned_at timestamptz,
    created_at timestamptz
  )
  language plpgsql stable security definer set search_path = '' as $$
begin
  if not athanor.is_admin() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  -- Both halves or neither. Two null-tests rather than a gate on a value: in plpgsql
  -- `IF <null>` simply does not run, so a condition that can itself be NULL fails OPEN
  -- (MIGRATIONS-ERRATA on 20260815093035 is the time that bit). `is null` is never NULL.
  if (p_before_created_at is null) <> (p_before_id is null) then
    raise exception 'abandoned dispatch cursor needs both created_at and id'
      using errcode = '22023';
  end if;
  return query
    select d.id, d.request_id, d.attempts, d.last_status, d.last_error,
           d.abandoned_at, d.created_at
      from athanor.notification_dispatches d
     where d.abandoned_at is not null
       and (p_before_created_at is null
            or (d.created_at, d.id) < (p_before_created_at, p_before_id))
     order by d.created_at desc, d.id desc
     limit least(greatest(coalesce(p_limit, 25), 1), 1000);
end; $$;

comment on function public.admin_list_abandoned_dispatches(integer, timestamptz, uuid) is
  'One page of abandoned notification dispatches, newest first (#534). The read side of the '
  '#521 outbox: rows whose retry budget was spent, kept 30 days and until now read by nobody. '
  'SECURITY DEFINER because athanor is not exposed to PostgREST; athanor.is_admin() re-checked '
  'inside, 42501 otherwise. Keyset on (created_at, id) desc, both cursor halves or neither. '
  'Excludes payload - the question is whether delivery was lost, not what the message said.';

revoke execute on function public.admin_list_abandoned_dispatches(integer, timestamptz, uuid)
  from public, anon;
grant execute on function public.admin_list_abandoned_dispatches(integer, timestamptz, uuid)
  to authenticated;

-- The order the cursor walks. Partial, because every query this index serves carries
-- `abandoned_at is not null` and the abandoned rows are by construction a small minority of a
-- table that mostly deletes itself on the next tick. Without it each page is a seq scan + sort
-- over the whole outbox — trivial today, and the kind of thing that later reads as "the admin
-- page got slow" rather than "the index is missing".
create index notification_dispatches_abandoned_created_at_id_idx
  on athanor.notification_dispatches (created_at desc, id desc)
  where abandoned_at is not null;
