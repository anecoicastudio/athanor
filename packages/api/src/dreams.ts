import {
  type Dream,
  dreamInsertSchema,
  type DreamInsert,
  dreamSchema,
  dreamUpdateSchema,
} from '@athanor/schemas';
import type { AthanorClient } from './client';

export const dreamKeys = {
  all: ['dreams'] as const,
  byProfile: (profileId: string) => ['dreams', 'profile', profileId] as const,
};

export async function createDream(client: AthanorClient, insert: DreamInsert): Promise<void> {
  const payload = dreamInsertSchema.parse(insert);
  const { error } = await client.from('dreams').insert(payload);
  if (error) throw error;
}

/** The single active dream (PRD §4.3: one active per profile). Null when none planted yet. */
export async function getActiveDream(
  client: AthanorClient,
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

/**
 * Create-or-edit the single active dream (PRD §4.3, frontend `02` §3.2). Trims +
 * validates via dreamUpdateSchema; updates the active row when one exists, else
 * inserts a new active dream. Never touches Aura (rule #1).
 */
export async function upsertActiveDream(
  client: AthanorClient,
  profileId: string,
  rawText: string,
): Promise<void> {
  const { text } = dreamUpdateSchema.parse({ text: rawText });
  const existing = await getActiveDream(client, profileId);
  if (existing) {
    // Single active dream per profile (partial unique index) — read-then-write is
    // safe here; the status guard scopes the update to the still-active row.
    const { error } = await client
      .from('dreams')
      .update({ text })
      .eq('id', existing.id)
      .eq('status', 'active');
    if (error) throw error;
    return;
  }
  await createDream(client, { profile_id: profileId, text });
}
