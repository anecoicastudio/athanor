-- #784 — the data export becomes complete, and stops being kept for ever.
--
-- Rulings (Marco, 2026-09-25, on #784):
--   (1) the archive carries the account email, the member's OWN media as files, and their
--       conversations in full (received messages included, the other party by handle only);
--   (2) archives are kept 7 days; a nightly pass deletes the object AND the row; the member
--       re-requests any time.
--
-- The email and the conversations are gdpr-export-job's business (Deno, no SQL). This migration
-- carries what the job cannot do from the API alone:
--
--   §1 the `exports` bucket's per-object ceiling rises to the largest member upload, because the
--      archive now holds copies of the member's media rather than their keys;
--   §2 `gdpr_export_media` — the member's own media objects, keyset-paged;
--   §3 `gdpr_export_reap_candidates` — WHICH `exports` objects have outlived their archive;
--   §4 `gdpr_export_reap_jobs` — the row half of the 7-day window.
--
-- ── Why the reap is split between SQL and the function ─────────────────────────────────────
--
-- Object deletion goes through the Storage API, never `delete from storage.objects`: that leaves
-- the physical file behind, still billed (20260828103400's header quotes the docs). So §3 only
-- LISTS, and gdpr-export-job deletes what it lists through `_shared/reap.ts` — the same loop
-- post-media-reaper and story-segment-reaper share. Rows have no such constraint and are deleted
-- here, in §4, called by the same pass.
--
-- The two halves are deliberately NOT coupled. §3's predicate is "no live job protects this
-- object", so an object whose row §4 already deleted is still a candidate the next night, and a
-- row whose object removal failed is gone without stranding anything the next pass cannot find.
-- Either order converges.
--
-- The pass rides on gdpr-export-job rather than on a new function and cron: that job already
-- holds the service-role `exports` client, already runs nightly (`gdpr-export-nightly`,
-- operator-created — docs/PRODUCTION-READINESS.md §5), and a second function would need its own
-- Vault pair and posture row for no gain. This migration schedules nothing.

-- ── §1 the bucket ceiling ──────────────────────────────────────────────────────────────────
--
-- 100 MiB (20260620140149) was sized for one JSON file. The archive now copies the member's own
-- objects in, and `candidacy-videos` accepts 200 MiB (20260617225450:137) — the largest ceiling
-- of the six media buckets. A lower cap here would refuse the copy of exactly the member's
-- largest file. The bucket has no client policies at all, so the only writer this widens is the
-- service-role job.
update storage.buckets
   set file_size_limit = 209715200
 where id = 'exports';

-- ── §2 the member's own media ──────────────────────────────────────────────────────────────
--
-- Not `gdpr_storage_footprint` (20260827110034), though it is the erasure's listing and the
-- obvious thing to reuse. Two properties make it wrong for this caller:
--   • it includes `exports` — the member's previous archives, which now contain copies of the
--     same media. An export built from it would copy the last export into this one;
--   • it has no cursor, only a 1000-row cap. That is right for erasure, which re-lists after each
--     removal; an export removes nothing, so the second page would never be reachable and a
--     large library would be cut at 1000 without a word.
-- So this is the same prefix sweep over the SIX user-upload buckets, keyset-paged on the
-- (bucket_id, name) pair storage.objects is unique on. The bucket list is the footprint's list
-- minus `exports`; supabase/functions/gdpr-export-job/media-buckets.test.ts holds the two
-- against each other, so a new media bucket cannot join the erasure without joining the export.
--
-- "Own" means under the member's `{uid}/` prefix — the six buckets' owner-write policies pin the
-- first path segment to the uploader. A chat image the member RECEIVED sits under the sender's
-- prefix and is therefore not listed: its bytes are the other person's data (ruling 1). The job
-- names it by filename only.
--
-- SECURITY INVOKER, like the footprint: the only caller is the job's service-role client, which
-- reads storage.objects unimpeded. LIKE with no ESCAPE is safe for the footprint's reason: the
-- prefix is built from a `uuid`, whose text form cannot contain `%` or `_`.
create function public.gdpr_export_media(
  p_profile_id uuid,
  p_after_bucket text default null,
  p_after_name text default null,
  p_limit int default 1000
)
returns table (bucket_id text, name text, created_at timestamptz, size bigint, mimetype text)
language sql
stable
security invoker
set search_path = ''
as $$
  select o.bucket_id,
         o.name,
         o.created_at,
         -- storage-api records both in `metadata` on upload; either can be absent on an object
         -- written by some other route, and the job treats a null size as unknown, not zero.
         nullif(o.metadata ->> 'size', '')::bigint,
         o.metadata ->> 'mimetype'
    from storage.objects o
   where o.bucket_id in (
           'post-media',
           'moments',
           'story-segments',
           'candidacy-videos',
           'avatars',
           'chat-media'
         )
     and o.name like p_profile_id::text || '/%'
     -- The cursor. Both halves null = the first page. A row comparison, so the page boundary
     -- is exact even when two buckets hold the same object name.
     and (p_after_bucket is null
          or (o.bucket_id, o.name) > (p_after_bucket, coalesce(p_after_name, '')))
   order by o.bucket_id, o.name
   -- PostgREST's max_rows (1000, supabase/config.toml) would truncate a larger page silently;
   -- clamping here makes the ceiling the function's. The job pages until a page comes back
   -- EMPTY, never until one comes back short, so a lower hosted max_rows costs a round trip
   -- rather than the tail of the library.
   limit least(greatest(coalesce(p_limit, 1000), 1), 1000);
$$;

comment on function public.gdpr_export_media(uuid, text, text, int) is
  'GDPR export (#784): every object under the member''s {uid}/ prefix in the six user-upload buckets — the erasure footprint''s list minus exports — keyset-paged on (bucket_id, name), ≤1000 a page. What gdpr-export-job copies into the archive as the member''s own media. Service-role only; read-only.';

revoke execute on function public.gdpr_export_media(uuid, text, text, int)
  from public, anon, authenticated;
grant execute on function public.gdpr_export_media(uuid, text, text, int) to service_role;

-- ── §3 WHICH exports objects have outlived their archive ───────────────────────────────────
--
-- Every object in `exports` sits under `{profile_id}/{job_id}…`: the archive is
-- `{uid}/{job}/archive.json` with its media beside it under `{uid}/{job}/media/…`, and archives
-- written before #784 are the single file `{uid}/{job}.json`. The job id is therefore the second
-- path segment, less a trailing `.json`.
--
-- An object is a candidate when NO live job protects it. A job protects its objects while it is
--   • 'requested' / 'processing' — being built, or requeued mid-build with media already copied;
--   • 'ready' with `expires_at` still in the future — the member's link is live.
-- Everything else is a candidate: a ready job past its expiry, a failed job, and an object whose
-- job row no longer exists at all (§4 deleted it, or it never did). That last arm is what makes
-- the halves independent, and it is also what reaps the pre-#784 archives, which were "kept as
-- long as you have the account": their 72-hour links expired long ago, so the first pass after
-- this migration takes them all. That is ruling 2 applied to the backlog, not a side effect.
--
-- The job-id comparison is on text, so a second segment that is not a uuid at all (nothing
-- writes one) is simply unprotected rather than a cast error that would stop the whole list.
--
-- The grace covers the one moment an object exists with nothing yet able to protect it: none
-- today, since the row is created before the job ever uploads — kept as margin against a future
-- writer that orders it the other way, at the cost of an hour on the backlog.
create function public.gdpr_export_reap_candidates(
  p_limit integer default 1000,
  p_grace interval default interval '1 hour'
) returns table (name text)
language sql
stable
security invoker
set search_path = ''
as $$
  select o.name
    from storage.objects o
   where o.bucket_id = 'exports'
     and greatest(o.created_at, o.updated_at) < now() - p_grace
     and not exists (
       select 1
         from public.gdpr_export_jobs j
        where j.id::text = regexp_replace(split_part(o.name, '/', 2), '\.json$', '')
          and (j.status in ('requested', 'processing')
               or (j.status = 'ready' and j.expires_at > now()))
     )
   order by greatest(o.created_at, o.updated_at), o.name
   limit greatest(1, least(coalesce(p_limit, 1000), 1000));
$$;

comment on function public.gdpr_export_reap_candidates(integer, interval) is
  'GDPR export retention (#784): objects in the exports bucket that no live gdpr_export_jobs row protects — a live row is requested, processing, or ready with an unexpired link. Oldest first, ≤1000. Read by gdpr-export-job, which deletes through the Storage API (_shared/reap.ts), never this table.';

revoke execute on function public.gdpr_export_reap_candidates(integer, interval)
  from public, anon, authenticated;
grant execute on function public.gdpr_export_reap_candidates(integer, interval) to service_role;

-- ── §4 the row half of the 7-day window ────────────────────────────────────────────────────
--
-- A 'ready' row goes once its link has expired: the job signs the link for the whole retention
-- window, so `expires_at` IS the end of the 7 days, and the row it would leave behind is a
-- Download button on a dead link. A 'failed' row carries no archive and goes seven days after
-- the job last touched it — long enough for the member to read «we couldn't prepare it», not
-- forever. 'requested' and 'processing' rows are never touched here: they are the queue, and
-- the job's servable-window fence already files a stuck one 'failed', which this then reaps.
--
-- Invoker, and returning the count so the pass can report it. service_role holds DELETE on the
-- table (20260620140149 `grant all … to service_role`); clients hold none, and still do not.
create function public.gdpr_export_reap_jobs()
returns integer
language sql
volatile
security invoker
set search_path = ''
as $$
  with gone as (
    delete from public.gdpr_export_jobs j
     where (j.status = 'ready' and j.expires_at <= now())
        or (j.status = 'failed' and j.updated_at < now() - interval '7 days')
    returning 1
  )
  select count(*)::int from gone;
$$;

comment on function public.gdpr_export_reap_jobs() is
  'GDPR export retention (#784): deletes ready rows whose link has expired and failed rows untouched for 7 days. Never touches requested/processing. Returns the count. Called by gdpr-export-job''s nightly pass; the bytes go separately (gdpr_export_reap_candidates + the Storage API).';

revoke execute on function public.gdpr_export_reap_jobs() from public, anon, authenticated;
grant execute on function public.gdpr_export_reap_jobs() to service_role;

