-- #574 — the index the two evidence-read policies correlate on.
--
-- `messages_select_reported` and `chat-media_select_reported` (20260831153525) both key on
--
--     exists (select 1 from public.reports r
--              where r.target_type = 'message' and r.target_id = <the message>)
--
-- and `reports` had no index on `target_id` at all: the creating migration indexed
-- (reporter_id, created_at, id) for the reporter's own feed and (status, created_at) for the
-- admin queue, and 20260701160202's FK-covering sweep could not have added one here because
-- `target_id` deliberately carries no FK. So each row an admin reads probes `reports` with a
-- sequential scan — once per message in the evidence read, once per object in the storage
-- read. It is invisible at launch volume and gets quadratically worse with the report table,
-- which is exactly the shape of thing that is cheap now and a migration under pressure later.
--
-- PARTIAL on the target type, mirroring `reports_admin_queue`'s shape and for the same reason:
-- the predicate that reads it always carries `target_type = 'message'`, so indexing the other
-- three types would be paying for rows no lookup here can match. Person and post reports are
-- resolved by a different path (a direct `profiles` / `posts` read keyed on `target_id` as a
-- primary key), which needs nothing from this table.
--
-- Not CONCURRENTLY: a migration runs inside a transaction, and CREATE INDEX CONCURRENTLY
-- cannot. The table is small enough that the brief write lock costs nothing; if it ever is
-- not, the honest fix is an out-of-band index build, not a weakened migration.

create index reports_message_target
  on public.reports (target_id)
  where target_type = 'message';

comment on index public.reports_message_target is
  '#574: the correlation index for messages_select_reported and chat-media_select_reported. '
  'Partial on target_type = ''message'' because both predicates always carry it.';
