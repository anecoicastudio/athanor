import { z } from 'zod';

// Mirrors supabase/migrations/20260620025158_m9_notifications.sql (06 §2.11, 09 §2.6).
// The 7 canonical notification types — must match notification_preferences.type + the M9 prefs UI.
export const NOTIFICATION_TYPES = [
  'moment',
  'dreamMilestone',
  'review',
  'eventReminder',
  'fundMilestone',
  'projectResponse',
  'connection',
] as const;
export const notificationType = z.enum(NOTIFICATION_TYPES);
export type NotificationType = z.infer<typeof notificationType>;

// Routing target for a tapped notification, e.g. {"kind":"momento","id":"…"}.
// `.nullish()` — the DB column is nullable and realtime may emit null (M6 nullish trap).
export const entityRefSchema = z.object({ kind: z.string(), id: z.string() }).nullish();
export type EntityRef = z.infer<typeof entityRefSchema>;

// Recipient reads OWN rows; written ONLY by the fan-out edge fn (service role). Body copy is a
// template_key + params (server-composed, IT/EN — 09 §3.6), never a hardcoded string.
export const notificationSchema = z.object({
  id: z.string().uuid(),
  recipient_id: z.string().uuid(),
  type: notificationType,
  template_key: z.string(),
  params: z.record(z.string(), z.unknown()).default({}),
  entity_ref: entityRefSchema,
  read_at: z.string().nullish(),
  created_at: z.string(),
});
export type Notification = z.infer<typeof notificationSchema>;
