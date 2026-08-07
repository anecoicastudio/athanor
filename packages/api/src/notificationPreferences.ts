import {
  type NotificationPreference,
  type NotifPrefInput,
  notificationPreferenceSchema,
} from '@athanor/schemas';
import type { AthanorClient } from './client';

/** All of the caller's notification preferences (RLS scopes to own). */
export async function getPreferences(client: AthanorClient): Promise<NotificationPreference[]> {
  const { data, error } = await client
    .from('notification_preferences')
    .select('id, profile_id, type, channel, enabled, created_at, updated_at');
  if (error) throw error;
  return (data ?? []).map((r) => notificationPreferenceSchema.parse(r));
}

/**
 * Upsert one preference (optimistic toggle). profile_id is set from the session (RLS WITH CHECK pins
 * it to auth.uid()). Unique (profile_id,type,channel) → upsert on that conflict target, not insert.
 */
export async function setNotifPref(client: AthanorClient, input: NotifPrefInput): Promise<void> {
  const { data: auth } = await client.auth.getUser();
  const profile_id = auth.user?.id;
  if (!profile_id) throw new Error('not authenticated');
  const { error } = await client
    .from('notification_preferences')
    .upsert(
      { profile_id, type: input.type, channel: input.channel, enabled: input.enabled },
      { onConflict: 'profile_id,type,channel' },
    );
  if (error) throw error;
}

/**
 * Master «Notifiche push» (default-on when absent). Reads via get_own_profile —
 * push_enabled is column-denied to direct selects since M10 visibility scoping.
 */
export async function getPushEnabled(client: AthanorClient): Promise<boolean> {
  const { data: auth } = await client.auth.getUser();
  const id = auth.user?.id;
  if (!id) return true;
  const { data, error } = await client.rpc('get_own_profile').maybeSingle();
  if (error) throw error;
  return data?.push_enabled ?? true;
}

/** Flip the master push toggle (profiles.push_enabled; granted to authenticated by the revoke migration). */
export async function setPushEnabled(client: AthanorClient, enabled: boolean): Promise<void> {
  const { data: auth } = await client.auth.getUser();
  const id = auth.user?.id;
  if (!id) throw new Error('not authenticated');
  const { error } = await client.from('profiles').update({ push_enabled: enabled }).eq('id', id);
  if (error) throw error;
}

export type { NotificationPreference };
