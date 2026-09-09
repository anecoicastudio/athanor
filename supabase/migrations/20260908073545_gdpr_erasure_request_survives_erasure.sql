-- #107: the erasure request must outlive the erasure it records.
--
-- Found while wiring the account delete, and it makes the issue's own goal — «finish logic.ts so
-- a request reaches `done`» — literally unreachable as the table stands:
--
--   gdpr_erasure_requests.profile_id  references profiles (id) ON DELETE CASCADE
--
-- Step (4b) deletes auth.users, which cascades profiles, which cascades THE REQUEST ROW. The
-- job's last statement is `update gdpr_erasure_requests set status = 'done' where id = …`, and
-- it would have matched zero rows — no error, no warning, PostgREST answers 204 to an update
-- that changed nothing. A successful erasure would have left the request table exactly as an
-- unsuccessful one does: empty.
--
-- That is #107's original complaint wearing new clothes. «The audit trail says nothing happened
-- while something irreversible did» was about a `failed` row; a row that deletes itself is
-- worse, because there is nothing left to read at all. GDPR Art. 5(2) asks the controller to be
-- able to DEMONSTRATE compliance, and a fulfilled request that leaves no trace demonstrates
-- nothing — the one record proving the obligation was met is the first casualty of meeting it.
--
-- ON DELETE SET NULL, and the column becomes nullable. What survives is «an erasure request was
-- created at T and completed at T+n» with no subject attached, which is exactly the shape the
-- rest of the ruling takes: keep the record, drop the identity. `updated_at` is the completion
-- time — the touch trigger stamps it on the status write, which now happens after the account is
-- gone. No new column, because there is no new fact.
--
-- The row is invisible to clients afterwards by construction rather than by a new policy: both
-- policies are `(select auth.uid()) = profile_id`, and NULL is equal to nothing.

alter table public.gdpr_erasure_requests
  alter column profile_id drop not null;

alter table public.gdpr_erasure_requests
  drop constraint gdpr_erasure_requests_profile_id_fkey;

alter table public.gdpr_erasure_requests
  add constraint gdpr_erasure_requests_profile_id_fkey
  foreign key (profile_id) references public.profiles (id) on delete set null;

comment on column public.gdpr_erasure_requests.profile_id is
  'The requester, or NULL once the erasure has run (#107): the FK is ON DELETE SET NULL so the account cascade cannot take the record of its own request with it. A NULL row is the accountability trace (Art. 5(2)) — created_at is when it was asked for, updated_at when it completed — and it is invisible to every client, because both RLS policies compare it to auth.uid().';

comment on table public.gdpr_erasure_requests is
  'GDPR right-to-erasure requests (type-to-confirm in-app). Owner inserts a request + reads own status; the service-role erasure-job (11) performs the cascade honoring legal retention (10 §5.4). No client UPDATE/DELETE — deletion is exclusively the service-role path. Since #107 a completed request survives the account it erased, with profile_id NULL.';
