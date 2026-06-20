-- M9 notifications — hosted default-privilege lockdown (9th hosted-revoke).
-- New public tables on hosted Supabase auto-grant INSERT/UPDATE/DELETE to anon+authenticated via
-- default privileges; RLS-only leaves a silent 0-row write hole (a 42501 only on INSERT).
-- notifications is service-role-write (fan-out only) → strip client INSERT/DELETE (keep SELECT +
-- the column-narrowed UPDATE(read_at)). notification_preferences is owner CRUD-minus-delete → strip
-- DELETE. Also grant authenticated UPDATE on the new profiles.push_enabled column — profiles uses a
-- column-scoped UPDATE grant (identity_verified etc. are server-only) and the new column isn't in it,
-- so setPushEnabled would 42501 without this.

revoke insert, delete on table public.notifications from authenticated;
revoke insert, update, delete on table public.notifications from anon;

revoke delete on table public.notification_preferences from authenticated;
revoke insert, update, delete on table public.notification_preferences from anon;

grant update (push_enabled) on table public.profiles to authenticated;
