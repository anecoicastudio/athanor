-- Admin waitlist read, keyset edition (#335).
--
-- `admin_list_waitlist(p_limit integer default 5000)` (20260630174955) handed the panel and
-- the CSV export the whole table in one call: the web page rendered every row into one
-- <table>, the export built the whole file in memory, and both ran inside a Worker with a
-- 10 ms CPU budget. Correct at launch size, mechanically worse with every signup.
--
-- Replaced — same name, keyset signature — rather than overloaded: PostgREST cannot choose
-- between two `admin_list_waitlist` candidates whose defaults both satisfy an empty argument
-- list ("Could not choose the best candidate function"), so the old shape has to go first.
--
-- Cursor = the last row's (created_at, id). The row now carries `id`, which the old shape
-- deliberately omitted ("no id — export/display only"): it is the tie-break column, and a
-- keyset without one skips or repeats a row whenever two signups share a timestamp. Both
-- halves of the cursor or neither — a half cursor is a caller bug and raises 22023 rather
-- than silently restarting at page 1, the same stance `getReportQueue` takes in
-- packages/api/src/admin.ts.
--
-- `p_limit` is clamped to 1..1000 inside the function. The 5000 default is gone on purpose:
-- no page wants it, and the export walks the cursor in pages instead of asking for
-- everything at once. The clamp is what makes that a property rather than a convention.
--
-- Same gate as before: SECURITY DEFINER (the table has no SELECT policy; rows are readable
-- only through these admin RPCs), `athanor.is_admin()` re-checked inside, 42501 otherwise;
-- EXECUTE revoked from public + anon, granted to authenticated. 0121 pins anon's and PUBLIC's
-- executable surface by name, so the revoke is what keeps it green. No aura path (rule #1).

drop function public.admin_list_waitlist(integer);

create function public.admin_list_waitlist(
  p_limit integer default 25,
  p_before_created_at timestamptz default null,
  p_before_id uuid default null
)
  returns table (id uuid, email text, locale text, source text, created_at timestamptz)
  language plpgsql stable security definer set search_path = '' as $$
begin
  if not athanor.is_admin() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  -- Both halves or neither. Compared as two null-tests rather than gated on a value: in
  -- plpgsql `IF <null>` simply does not run, so a condition that can itself be NULL fails
  -- open (MIGRATIONS-ERRATA on 20260815093035 is the time that bit). `is null` is never NULL.
  if (p_before_created_at is null) <> (p_before_id is null) then
    raise exception 'waitlist cursor needs both created_at and id' using errcode = '22023';
  end if;
  return query
    select w.id, w.email, w.locale, w.source, w.created_at
    from public.email_waitlist w
    where p_before_created_at is null
       or (w.created_at, w.id) < (p_before_created_at, p_before_id)
    order by w.created_at desc, w.id desc
    limit least(greatest(coalesce(p_limit, 25), 1), 1000);
end; $$;

revoke execute on function public.admin_list_waitlist(integer, timestamptz, uuid) from public, anon;
grant execute on function public.admin_list_waitlist(integer, timestamptz, uuid) to authenticated;

-- The order the cursor walks. `email_waitlist` had only the unique email index, so every
-- page was a seq scan + sort — trivial at 5k rows, and exactly the degradation #335's own
-- comment names for `getEditionAuditTrail`: a keyset whose columns are unindexed gets slow
-- in a way that reads as "the query got slow", not "the index is missing".
create index email_waitlist_created_at_id_idx
  on public.email_waitlist (created_at desc, id desc);
