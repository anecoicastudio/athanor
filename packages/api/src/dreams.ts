import { dreamInsertSchema, type DreamInsert } from '@kaira/schemas';
import type { KairaClient } from './client';

export const dreamKeys = {
  all: ['dreams'] as const,
  byProfile: (profileId: string) => ['dreams', 'profile', profileId] as const,
};

export async function createDream(client: KairaClient, insert: DreamInsert): Promise<void> {
  const payload = dreamInsertSchema.parse(insert);
  const { error } = await client.from('dreams').insert(payload);
  if (error) throw error;
}
