import { type Dream, dreamInsertSchema, type DreamInsert, dreamSchema } from '@auria/schemas';
import type { AuriaClient } from './client';

export const dreamKeys = {
  all: ['dreams'] as const,
  byProfile: (profileId: string) => ['dreams', 'profile', profileId] as const,
};

export async function createDream(client: AuriaClient, insert: DreamInsert): Promise<void> {
  const payload = dreamInsertSchema.parse(insert);
  const { error } = await client.from('dreams').insert(payload);
  if (error) throw error;
}

/** The single active dream (PRD §4.3: one active per profile). Null when none planted yet. */
export async function getActiveDream(
  client: AuriaClient,
  profileId: string,
): Promise<Dream | null> {
  const { data, error } = await client
    .from('dreams')
    .select('*')
    .eq('profile_id', profileId)
    .eq('status', 'active')
    .is('deleted_at', null)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return dreamSchema.parse(data);
}
