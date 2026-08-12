import type { SupabaseClient } from '@supabase/supabase-js';
import { type PushPlatform, pushTokenInsertSchema } from '@athanor/schemas';
import type { Database } from './database.types';

type RegisterArgs = { token: string; platform: PushPlatform; deviceId?: string | null };

/**
 * Idempotent upsert of the caller's Expo push token on the (profile_id, token) unique
 * constraint. profile_id is taken from the session — never client-passed for someone else
 * (RLS would reject it anyway). Backend 01 §418.
 */
export async function registerPushToken(
  supabase: SupabaseClient<Database>,
  { token, platform, deviceId = null }: RegisterArgs,
): Promise<void> {
  const { data } = await supabase.auth.getUser();
  const profileId = data.user?.id;
  if (!profileId) return; // no session → nothing to register
  const payload = pushTokenInsertSchema.parse({
    profile_id: profileId,
    token,
    platform,
    device_id: deviceId,
  });
  const { error } = await supabase
    .from('push_tokens')
    .upsert(payload, { onConflict: 'profile_id,token' });
  if (error) throw error;
}

/** Owner-delete a single device token (logout / uninstall). */
export async function unregisterPushToken(
  supabase: SupabaseClient<Database>,
  token: string,
): Promise<void> {
  const { error } = await supabase.from('push_tokens').delete().eq('token', token);
  if (error) throw error;
}
