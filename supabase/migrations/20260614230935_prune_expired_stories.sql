-- Daily housekeeping: soft-delete expired, unpinned story segments. Pinned step segments
-- survive (pinned-to-journey, PRD §4.5). Query-time RLS already hides these (story_segments
-- select policy) — this only stops the table growing unbounded. pg_cron bypasses RLS (postgres ctx).
create extension if not exists pg_cron;

select cron.schedule(
  'prune-expired-story-segments',
  '17 3 * * *',                                     -- 03:17 daily (off-peak)
  $$
    update public.story_segments
       set deleted_at = now()
     where deleted_at is null
       and pinned = false
       and expires_at <= now()
  $$
);
