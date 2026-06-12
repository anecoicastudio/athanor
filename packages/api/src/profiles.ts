import type { OnboardingAnswers, Profile } from '@kaira/schemas';
import type { KairaClient } from './client';

/** TanStack Query key factory (rule: per-entity factories). */
export const profileKeys = {
  all: ['profiles'] as const,
  detail: (id: string) => ['profiles', id] as const,
  handleAvailable: (handle: string) => ['profiles', 'handle-available', handle] as const,
};

/**
 * Maps a DB row to the Profile schema type.
 * Adaptations:
 *   - handle: DB is `string | null`; Profile mirrors this (nullable). A null handle means the
 *     row exists but onboarding is incomplete — callers must NOT treat this as "no profile".
 *   - visibility: DB is `Json`; Profile expects `Record<string, 'public'|'members'|'private'>`.
 *     Cast is safe because the DB check constraint and onboarding write enforce valid values.
 */
function rowToProfile(row: {
  id: string;
  handle: string | null;
  bio: string | null;
  locale: string;
  visibility: unknown;
  identity_tags: string[];
  seeking: string[];
  created_at: string;
  updated_at: string;
}): Profile {
  return {
    id: row.id,
    handle: row.handle,
    bio: row.bio,
    locale: row.locale as Profile['locale'],
    visibility: row.visibility as Profile['visibility'],
    identity_tags: row.identity_tags,
    seeking: row.seeking,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export async function getOwnProfile(client: KairaClient, userId: string): Promise<Profile | null> {
  const { data, error } = await client.from('profiles').select('*').eq('id', userId).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return rowToProfile(data);
}

export async function isHandleAvailable(client: KairaClient, handle: string): Promise<boolean> {
  const { count, error } = await client
    .from('profiles')
    .select('id', { count: 'exact', head: true })
    .eq('handle', handle);
  if (error) throw error;
  return (count ?? 0) === 0;
}

export async function updateOnboardingProfile(
  client: KairaClient,
  userId: string,
  answers: OnboardingAnswers,
): Promise<void> {
  const { error } = await client.from('profiles').update(answers).eq('id', userId);
  if (error) throw error;
}
