-- #733, second half — the ban has to be STICKY, it has to reach the requests that already
-- exist and the §7.5 re-queue path, and it has to close the Data API, not only GoTrue.
-- /code-review on 20260910130552 found the four holes this file closes; that migration is
-- applied and append-only, so the corrections land here rather than in it.
--
-- 1. STICKY. moderation-enforce writes the same column ABSOLUTELY (ban_duration → GoTrue sets
--    banned_until = now() + duration, logic.ts:60-68), so a 7-day suspension resolved against a
--    member who had already asked to be erased would replace the ~100-year ban with a week, and
--    the documented un-ban (ban_duration 'none') would clear it outright. A BEFORE UPDATE OF
--    banned_until trigger on auth.users re-raises the value while an erasure request is open
--    (status <> 'done'). Consequence for operators (RELEASE-RUNBOOK §7.5): withdrawing a request
--    means deleting its row FIRST, then re-deriving banned_until from profiles.banned_at /
--    suspended_until — never a bare `set banned_until = null`, which would also wipe a
--    co-existing moderation ban.
-- 2. BACKFILL + RE-QUEUE. Rows already on requested/processing get the ban now, once. The
--    request trigger becomes INSERT OR UPDATE OF status WHEN new.status = 'requested', so the
--    §7.5 re-queue (`update … set status = 'requested'`) bans exactly as a fresh request does.
-- 3. THE DATA API. athanor.is_active() is the IMMEDIATE half of the two-half lockout
--    (20260813045347:5-11): restrictive write policies over the social surface, denied on the
--    next PostgREST statement. It now also reads "no open erasure request", so a JWT already
--    issued to a second device — valid for up to jwt_expiry, 3600 s — cannot keep writing
--    momenti, messages or votes after the tap. Reads stay open until the token dies, which is
--    the same window every ban here accepts.
--
-- Same DEFINER rationale as 20260910130552 and 20260825074614: service_role holds no UPDATE
-- on auth.users; postgres does; the bodies touch one column of one row.

-- ── 1. sticky ─────────────────────────────────────────────────────────────────────────────
create or replace function public.gdpr_keep_erasure_ban()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1 from public.gdpr_erasure_requests r
     where r.profile_id = new.id and r.status <> 'done'
  ) then
    -- GREATEST ignores NULL operands: a cleared value is re-raised, a longer one is kept.
    new.banned_until := greatest(new.banned_until, now() + interval '876000 hours');
  end if;
  return new;
end;
$$;

comment on function public.gdpr_keep_erasure_ban() is
  'BEFORE UPDATE OF banned_until on auth.users (#733): while the member has an erasure request that is not done, the erasure ban (now() + 876000h, moderation-enforce''s BAN_FOREVER) cannot be shortened or cleared by a later moderation write or a bare operator UPDATE. Withdraw the request row first (RELEASE-RUNBOOK §7.5). DEFINER: service_role holds no UPDATE on auth.users.';

revoke execute on function public.gdpr_keep_erasure_ban() from public, anon, authenticated;

create trigger gdpr_erasure_ban_sticky
  before update of banned_until on auth.users
  for each row execute function public.gdpr_keep_erasure_ban();

-- ── 2. the request trigger also fires on the re-queue path ────────────────────────────────
drop trigger gdpr_erasure_request_bans_signin on public.gdpr_erasure_requests;
create trigger gdpr_erasure_request_bans_signin
  after insert or update of status on public.gdpr_erasure_requests
  for each row when (new.status = 'requested')
  execute function public.gdpr_ban_on_erasure_request();

-- the open-request lookup is_active() and the sticky trigger now make on every social write
create index if not exists gdpr_erasure_requests_open_by_profile
  on public.gdpr_erasure_requests (profile_id)
  where status <> 'done';

-- ── 3. the Data API half ──────────────────────────────────────────────────────────────────
create or replace function athanor.is_active()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select p.banned_at is null
        and (p.suspended_until is null or p.suspended_until <= now())
        and not exists (
          select 1 from public.gdpr_erasure_requests r
           where r.profile_id = p.id and r.status <> 'done')
       from public.profiles p
      where p.id = (select auth.uid())),
    false);
$$;

comment on function athanor.is_active() is
  'Not banned, not currently suspended (#106). DEFINER: suspended_until/banned_at have no client grant. Composed as restrictive write policies; also the guard inside user-callable DEFINER write RPCs, which RLS cannot reach. Since #733 also false while the member has an erasure request that is not done: the request bans GoTrue in the same transaction (gdpr_erasure_request_bans_signin), and this is the half that closes the Data API for a JWT already issued.';

-- ── 4. backfill: requests that existed before 20260910130552 ──────────────────────────────
update auth.users u
   set banned_until = greatest(u.banned_until, now() + interval '876000 hours')
  from public.gdpr_erasure_requests r
 where r.profile_id = u.id
   and r.status in ('requested', 'processing');
