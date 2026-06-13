import {
  type OnboardingAnswers,
  onboardingAnswersSchema,
  type ProfileUpdate,
  profileSchema,
  profileUpdateSchema,
} from '@kaira/schemas';
import type { KairaClient } from './client';

/** TanStack Query key factory (rule: per-entity factories). */
export const profileKeys = {
  all: ['profiles'] as const,
  detail: (id: string) => ['profiles', id] as const,
  handleAvailable: (handle: string) => ['profiles', 'handle-available', handle] as const,
};

export async function getOwnProfile(client: KairaClient, userId: string) {
  const { data, error } = await client.from('profiles').select('*').eq('id', userId).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  // profileSchema.parse validates the DB row at the trust boundary and strips extra columns.
  return profileSchema.parse(data);
}

/** UX pre-check only; the DB unique constraint is the real guard — writers must handle 23505. */
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
  // parse strips unknown keys that TS structural typing would otherwise pass through.
  const payload = onboardingAnswersSchema.parse(answers);
  const { error } = await client.from('profiles').update(payload).eq('id', userId);
  if (error) throw error;
}

/** Partial profile edit (Profilo Evolutivo). RLS enforces owner-only; schema strips unknown keys. */
export async function updateProfile(
  client: KairaClient,
  userId: string,
  patch: ProfileUpdate,
): Promise<void> {
  const payload = profileUpdateSchema.parse(patch);
  const { error } = await client.from('profiles').update(payload).eq('id', userId);
  if (error) throw error;
}
