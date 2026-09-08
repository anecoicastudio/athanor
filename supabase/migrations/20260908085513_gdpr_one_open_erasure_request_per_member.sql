-- #107 review follow-up, same PR: a member could have two erasure requests open at once, and
-- the second one recorded a lie.
--
-- Nothing stopped a member tapping «Richiedi la cancellazione» twice — the insert policy checks
-- ownership and `status = 'requested'`, not uniqueness. Both rows are then claimed by the SAME
-- batch (the claim query takes 20), and the loop erases the account on the first. The second is
-- processed straight afterwards against a uuid that no longer exists: the RPCs match nothing,
-- `auth.admin.deleteUser` fails, and the request lands on `failed` — a fulfilled erasure filed
-- as a failure, on the row a member is most likely to be shown.
--
-- Fixed at the source rather than in the loop. The alternative — re-reading each row's
-- `profile_id` immediately before its cascade — costs a query per request and only narrows the
-- window; this closes it, and it closes it for every future caller of the table rather than for
-- the one loop that reads it today.
--
-- PARTIAL, on `status = 'requested'` only. A member whose erasure has completed must still be
-- able to file another one if they come back and sign up again, and the historical rows (`done`,
-- `failed`, and the pre-#107 `partial`) must be allowed to pile up — the index would otherwise
-- make the R-8 §7.5 reconcile impossible, since it re-queues several terminal rows at once.
--
-- `profile_id` is nullable since 20260908073545, and NULLs are distinct in a unique index, so a
-- completed request with no subject never collides. That is the behaviour we want: those rows
-- are the accountability trace, and there can be many.

-- Existing duplicates first, or the index cannot be built. Keeps the OLDEST open request per
-- member — it is the one whose `created_at` starts the Article 17 clock — and drops the rest.
-- On both hosted projects this deletes nothing today; it exists so the migration replays from
-- zero and survives a project where it does not.
delete from public.gdpr_erasure_requests r
 where r.status = 'requested'
   and r.profile_id is not null
   and exists (
     select 1 from public.gdpr_erasure_requests older
      where older.profile_id = r.profile_id
        and older.status = 'requested'
        and (older.created_at, older.id) < (r.created_at, r.id)
   );

create unique index gdpr_erasure_requests_one_open_per_profile
  on public.gdpr_erasure_requests (profile_id)
  where status = 'requested';

comment on index public.gdpr_erasure_requests_one_open_per_profile is
  'One OPEN erasure request per member (#107). Terminal rows are unconstrained: a member who returns may ask again, and R-8 §7.5 re-queues several historical rows at once. A duplicate insert raises 23505, which packages/api treats as success — the member did ask, and the request is already on file.';
