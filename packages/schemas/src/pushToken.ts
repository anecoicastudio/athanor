import { z } from 'zod';

// Mirrors supabase/migrations/20260617082135_push_tokens.sql (schemas mirror migrations).
// Write-boundary shape only: the payload registerPushToken upserts. The full row model was
// deleted unread in #272 — derive a row schema from the migration if a reader ever appears.
export const pushPlatformSchema = z.enum(['ios', 'android']);
export type PushPlatform = z.infer<typeof pushPlatformSchema>;

export const pushTokenInsertSchema = z.object({
  profile_id: z.string().uuid(),
  token: z.string().min(1).max(512), // mirrors the char_length(token) between 1 and 512 CHECK
  platform: pushPlatformSchema,
  device_id: z.string().nullish(), // text, no bound; the column tolerates an absent key too
});
export type PushTokenInsert = z.infer<typeof pushTokenInsertSchema>;
