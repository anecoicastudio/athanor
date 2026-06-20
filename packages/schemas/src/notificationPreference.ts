import { z } from 'zod';
import { NOTIFICATION_TYPES, notificationType } from './notification';

// Mirrors supabase/migrations/20260620025158_m9_notifications.sql (06 §2.12).
// One row per (profile_id, type, channel). The master «Notifiche push» toggle is NOT a row here —
// it lives on profiles.push_enabled (Decision #1). channel='push' rows gate per-type push delivery.
export const NOTIFICATION_CHANNELS = ['push', 'in_app'] as const;
export const notificationChannel = z.enum(NOTIFICATION_CHANNELS);
export type NotificationChannel = z.infer<typeof notificationChannel>;

// Re-export the shared type list so callers can iterate prefs rows without importing two modules.
export { NOTIFICATION_TYPES };

// Owner CRUD on own.
export const notificationPreferenceSchema = z.object({
  id: z.string().uuid(),
  profile_id: z.string().uuid(),
  type: notificationType,
  channel: notificationChannel,
  enabled: z.boolean(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type NotificationPreference = z.infer<typeof notificationPreferenceSchema>;

// Upsert input (the prefs toggle): {type, channel, enabled}. profile_id is set server-side from the session.
export const notifPrefInput = notificationPreferenceSchema.pick({
  type: true,
  channel: true,
  enabled: true,
});
export type NotifPrefInput = z.infer<typeof notifPrefInput>;
