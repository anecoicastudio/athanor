-- #129 — the finished export tells the member (Art. 15/20 mechanics; 10 §5.3, 09 §3.5.1).
--
-- gdpr-export-job minted the signed URL, set status='ready', and stopped: no notification
-- type existed, so a ready archive was visible only to a member who happened to reopen
-- Settings → Data Export. This wires the missing producer through the existing fan-out
-- (athanor.enqueue_notification → notification-fan-out, the sole writer of notifications
-- rows). Guarded no-op like every producer: unconfigured fan-out never blocks the job.
--
-- Type decision: a NEW 'gdprExport' type, following 'moderation' (#313, 20260813135602) —
-- a borrowed type would render with that type's lead in the app AND share its per-type
-- mute. Like 'moderation'/'connection' it gets NO prefs-UI row: a member must not be able
-- to silently mute the delivery of their own data; the in-app row always lands, push obeys
-- only the master toggle. Mirrored in packages/schemas NOTIFICATION_TYPES (same commit).
--
-- Producer is an AFTER UPDATE trigger on gdpr_export_jobs (status → 'ready'), not a call
-- inside the edge fn: every writer path (including a future retry or backfill) notifies,
-- and the edge fn keeps zero knowledge of the fan-out transport.

-- ── 1. 'gdprExport' joins the closed type set ────────────────────────────────────────────
-- Both CHECKs are inline column constraints from 20260620025158; Postgres named them
-- <table>_type_check.
alter table public.notifications drop constraint notifications_type_check;
alter table public.notifications add constraint notifications_type_check
  check (type in ('moment','dreamMilestone','review','eventReminder','fundMilestone',
                  'projectResponse','connection','moderation','gdprExport'));

alter table public.notification_preferences drop constraint notification_preferences_type_check;
alter table public.notification_preferences add constraint notification_preferences_type_check
  check (type in ('moment','dreamMilestone','review','eventReminder','fundMilestone',
                  'projectResponse','connection','moderation','gdprExport'));

-- ── 2. producer: status → 'ready' notifies the requester ─────────────────────────────────
create or replace function athanor.notify_gdpr_export_ready() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'ready' and old.status is distinct from 'ready' then
    perform athanor.enqueue_notification(
      new.profile_id, 'gdprExport', 'notif.tpl.gdprExport',
      '{}'::jsonb,
      jsonb_build_object('kind', 'gdprExport', 'id', new.id::text)
    );
  end if;
  return new;
end; $$;

comment on function athanor.notify_gdpr_export_ready() is
  '#129: gdpr_export_jobs status→ready enqueues the «your archive is ready» notification (type gdprExport, notif.tpl.gdprExport) to the requester via the guarded fan-out. SECURITY DEFINER to reach athanor.enqueue_notification; search_path locked; execute revoked below (trigger-only).';

revoke execute on function athanor.notify_gdpr_export_ready() from public, anon, authenticated;

create trigger gdpr_export_jobs_notify_ready
  after update on public.gdpr_export_jobs
  for each row execute function athanor.notify_gdpr_export_ready();
