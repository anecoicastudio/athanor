-- M10 Launch · admin read of the pre-launch email waitlist (web /admin count + CSV export).
--
-- The email_waitlist table stays insert-only at the table level — its rows are
-- "readable only via service_role" by design (see 20260614175846_email_waitlist.sql).
-- Rather than loosen that grant, expose two SECURITY DEFINER functions in `public`
-- (PostgREST only RPCs the public schema) that re-check athanor.is_admin()
-- (app_metadata, rule #2) — mirroring public.resolve_report's gate. Admins get the
-- count and the rows; everyone else gets 42501. No aura path (rule #1): read-only.

-- ── count of waitlist signups (the "how many are interested" number) ─────────
create or replace function public.admin_waitlist_count()
  returns integer
  language plpgsql stable security definer set search_path = '' as $$
begin
  if not athanor.is_admin() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  return (select count(*)::int from public.email_waitlist);
end; $$;
revoke execute on function public.admin_waitlist_count() from public, anon;
grant execute on function public.admin_waitlist_count() to authenticated;

-- ── the rows themselves (newest first) — feeds the /admin table + CSV export ──
create or replace function public.admin_list_waitlist(p_limit integer default 5000)
  returns table (email text, locale text, source text, created_at timestamptz)
  language plpgsql stable security definer set search_path = '' as $$
begin
  if not athanor.is_admin() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  return query
    select w.email, w.locale, w.source, w.created_at
    from public.email_waitlist w
    order by w.created_at desc
    limit greatest(coalesce(p_limit, 5000), 0);
end; $$;
revoke execute on function public.admin_list_waitlist(integer) from public, anon;
grant execute on function public.admin_list_waitlist(integer) to authenticated;
