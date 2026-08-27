-- #573 — GDPR erasure reaches EVERY bucket, not just candidacy-videos.
--
-- 20260815131925's `gdpr_erase_fund_footprint` returns a blob manifest hard-filtered to
-- `bucket_id = 'candidacy-videos'`. That filter is correct for what that function is — the
-- fund reach's own blob half — but it was also the erasure's ENTIRE storage reach, because
-- erasure-job removed that manifest and nothing else. Bytes in `post-media`, `moments`,
-- `story-segments`, `avatars` and `chat-media` therefore survived a GDPR erasure, as did the
-- member's own `exports` archives, which are the densest copy of all: one whole personal
-- dataset per object, retained indefinitely and never deleted by any code path.
-- MIGRATIONS-ERRATA.md records the same gap against 20260827054252's §2 comment.
--
-- Its own function rather than a widened `gdpr_erase_fund_footprint`, for three reasons:
-- 20260815131925 is applied and migrations are append-only (rule 7); that function's name
-- says «fund» and a manifest carrying avatars would make the name a lie; and
-- supabase/tests/0104's `results_eq` deliberately asserts the narrow manifest with a
-- second-bucket object seeded to prove it — that assertion is TRUE about the fund reach and
-- stays true. This function is the account-wide sweep, 0137 is its test, and erasure-job
-- calls both: the fund one for its transaction, this one for every byte.
--
-- SECURITY INVOKER, like its sibling and for the same reason (#145): the only caller is
-- erasure-job's service-role client, which already reads storage.objects unimpeded, so
-- definer rights would add nothing and would add a bypass.

-- ── The account-wide storage manifest ──────────────────────────────────────────────────────
create function public.gdpr_storage_footprint(p_profile_id uuid, p_limit int default 1000)
returns table (bucket_id text, name text)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_prefix text := p_profile_id::text || '/';
begin
  -- Same refusal as the fund reach. The sentinel owns no objects, so this guards nothing
  -- today — it guards the day someone passes the wrong uuid to a function whose result is
  -- fed straight into `storage.remove()`.
  if p_profile_id = public.gdpr_tombstone_profile_id() then
    raise exception 'refusing to erase the tombstone sentinel itself';
  end if;

  return query
    select o.bucket_id, o.name
      from storage.objects o
      -- EXPLICIT list, never an unfiltered sweep of storage.objects. An erasure that
      -- silently reached a bucket nobody had decided about is how a future retention
      -- requirement gets deleted by a job that was only ever reviewed against today's
      -- buckets. supabase/functions/erasure-job/sweep-buckets.test.ts mirrors this list
      -- against every bucket any migration creates AND against packages/api's
      -- MediaBucketName, so a new bucket goes red here until its erasure fate is declared —
      -- which is precisely the drift that let chat-media reach main unswept.
      --
      -- `exports` is on the list and is not user-uploaded media: it holds the archives
      -- gdpr-export-job writes at `{profile_id}/{job_id}.json`. Erasing the member while
      -- leaving those behind would leave the most complete copy of their data on disk.
     where o.bucket_id in (
             'post-media',
             'moments',
             'story-segments',
             'candidacy-videos',
             'avatars',
             'chat-media',
             'exports'
           )
       -- Every bucket keys its objects `{uid}/…` (the owner-write storage policies enforce
       -- exactly that shape), so one prefix covers all seven with no per-bucket query and no
       -- DB-column resolution. LIKE is safe with no ESCAPE here for a reason worth stating:
       -- p_profile_id is typed `uuid`, so its text form can only ever be [0-9a-f-]{36} —
       -- neither `%` nor `_` can appear in the pattern. This would NOT hold for a text
       -- parameter.
       and o.name like v_prefix || '%'
     -- Deterministic, so a truncated page is the same page next round rather than a
     -- reshuffled one. bucket_id first so a round groups into as few remove() calls as
     -- possible.
     order by o.bucket_id, o.name
     -- Clamped to PostgREST's `max_rows = 1000` (supabase/config.toml), which is also
     -- storage-api's documented ceiling for one remove() call. A caller asking for more
     -- would be silently truncated by PostgREST anyway; clamping here makes the ceiling a
     -- property of the function rather than of the transport.
     limit least(greatest(coalesce(p_limit, 1000), 1), 1000);
end;
$$;

comment on function public.gdpr_storage_footprint(uuid, int) is
  'GDPR erasure, account-wide blob manifest (#573): every storage object under the member''s {uid}/ prefix across all seven declared buckets, capped at p_limit (≤1000). Derived from storage.objects rather than from the path convention, so a retry after a failed removal still lists what remains. Service-role only; read-only and idempotent.';

revoke all on function public.gdpr_storage_footprint(uuid, int) from public, anon, authenticated;
grant execute on function public.gdpr_storage_footprint(uuid, int) to service_role;
