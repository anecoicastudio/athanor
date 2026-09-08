-- #107 review follow-up, same PR: the waitlist purge could delete a DIFFERENT person's row.
--
-- The purge has to fold case, because `athanor.purge_email_waitlist` does
-- (`20260620140149:111`, `lower(u.email) = lower(w.email)`) and a row stored as `Ada@X.test` is
-- the same waitlist entry as the `ada@x.test` GoTrue hands back. PostgREST cannot express
-- `lower(col) = lower($1)` as a filter, so the job reached for `.ilike`, escaping `\`, `%` and
-- `_` — the LIKE metacharacters.
--
-- That is not enough, and the gap is PostgREST's rather than Postgres's: **PostgREST substitutes
-- `*` for `%` in a `like`/`ilike` value before Postgres ever sees the pattern**, and there is no
-- escape for it at that layer. `*` is legal unquoted in a local part (RFC 5322 atext). Verified
-- against staging with two rows, `axb@probe.test` and `a*b@probe.test`:
--
--     GET /rest/v1/email_waitlist?email=ilike.a*b@probe.test   →   BOTH rows
--
-- So erasing `a*b@…` would have deleted `axb@…` — somebody else's waitlist entry, silently, on
-- a path whose whole purpose is to remove exactly one person's data.
--
-- A function is the only place the fold can happen safely: the comparison is an equality on
-- `lower()`, with no pattern language anywhere in it.
--
-- SECURITY INVOKER, following the gdpr_erase_fund_footprint precedent: the only caller is the
-- erasure job's service-role client, which already holds `email_waitlist`.

create function public.gdpr_purge_waitlist_email(p_email text)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_deleted integer;
begin
  if p_email is null or btrim(p_email) = '' then
    return 0;
  end if;

  with gone as (
    delete from public.email_waitlist
     where lower(email) = lower(btrim(p_email))
    returning 1
  )
  select count(*)::integer into v_deleted from gone;

  return v_deleted;
end;
$$;

comment on function public.gdpr_purge_waitlist_email(text) is
  'GDPR erasure, step 4a (#107): delete the erased member''s email_waitlist rows, matching on lower(email) the way athanor.purge_email_waitlist does. A function rather than a PostgREST .ilike filter because PostgREST rewrites `*` to `%` in a pattern and offers no escape, so a local part containing `*` would have matched — and deleted — another person''s row. Returns how many rows went. Service-role only; idempotent.';

revoke execute on function public.gdpr_purge_waitlist_email(text) from public, anon, authenticated;
grant execute on function public.gdpr_purge_waitlist_email(text) to service_role;
