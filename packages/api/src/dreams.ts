import type { DreamInsert } from '@kaira/schemas';
import type { KairaClient } from './client';

export const dreamKeys = {
  all: ['dreams'] as const,
  byProfile: (profileId: string) => ['dreams', 'profile', profileId] as const,
};

export async function createDream(client: KairaClient, insert: DreamInsert): Promise<void> {
  const { error } = await client.from('dreams').insert(insert);
  if (error) throw error;
}
