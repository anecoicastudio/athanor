-- event_live_stats: make the read policy match its own claim (#137).
--
-- 20260615145423 declared "public read for published events" in both its header and
-- its `comment on table`, then created `event_live_stats_select_all` as `using (true)`
-- — no join back to events at all. Any caller could read is_live (and, until #120
-- dropped it, listener_count) for a soft-deleted event's id. Published here means what
-- it means everywhere else: `events.deleted_at is null` (there is no draft flag).
-- The applied migration cannot be edited (rule #7): this replaces the policy and
-- supabase/MIGRATIONS-ERRATA.md records the correction.
--
-- Consumers are unaffected: every live-stats read starts from an event row that
-- already passed events' own deleted_at filter.

drop policy "event_live_stats_select_all" on public.event_live_stats;

create policy "event_live_stats_select_published"
  on public.event_live_stats for select
  to anon, authenticated
  using (
    exists (
      select 1
      from public.events e
      where e.id = event_id
        and e.deleted_at is null
    )
  );
