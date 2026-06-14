import {
  type OnboardingAnswers,
  onboardingAnswersSchema,
  type ProfileUpdate,
  profileSchema,
  profileUpdateSchema,
} from '@athanor/schemas';
import type { AthanorClient } from './client';

/** TanStack Query key factory (rule: per-entity factories). */
export const profileKeys = {
  all: ['profiles'] as const,
  detail: (id: string) => ['profiles', id] as const,
  handleAvailable: (handle: string) => ['profiles', 'handle-available', handle] as const,
};

export async function getOwnProfile(client: AthanorClient, userId: string) {
  const { data, error } = await client.from('profiles').select('*').eq('id', userId).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  // profileSchema.parse validates the DB row at the trust boundary and strips extra columns.
  return profileSchema.parse(data);
}

/** UX pre-check only; the DB unique constraint is the real guard — writers must handle 23505. */
export async function isHandleAvailable(client: AthanorClient, handle: string): Promise<boolean> {
  const { count, error } = await client
    .from('profiles')
    .select('id', { count: 'exact', head: true })
    .eq('handle', handle);
  if (error) throw error;
  return (count ?? 0) === 0;
}

export async function updateOnboardingProfile(
  client: AthanorClient,
  userId: string,
  answers: OnboardingAnswers,
): Promise<void> {
  // parse strips unknown keys that TS structural typing would otherwise pass through.
  const payload = onboardingAnswersSchema.parse(answers);
  const { error } = await client.from('profiles').update(payload).eq('id', userId);
  if (error) throw error;
}

/** Postgres unique_violation — the `profiles.handle` unique index when an auto-derived handle clashes. */
function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code?: string }).code === '23505'
  );
}

/** Append a short random suffix, keeping the result within handleSchema (^[a-z0-9_]{3,30}$). */
function withRandomSuffix(base: string): string {
  const suffix = Math.random().toString(36).slice(2, 6); // up to 4 chars of [a-z0-9]
  return `${base.slice(0, 30 - suffix.length - 1)}_${suffix}`;
}

/**
 * Like {@link updateOnboardingProfile}, but tolerant of an auto-derived handle
 * that collides with an existing one (unique-index 23505). The onboarding flow
 * now derives the handle from the email via `suggestHandle`, which is
 * deterministic — two users sharing an email localpart would otherwise clash —
 * so we retry with a random suffix. Returns the handle that actually landed; the
 * user can rename later in Profilo. Non-collision errors propagate immediately.
 */
export async function updateOnboardingProfileWithHandleFallback(
  client: AthanorClient,
  userId: string,
  answers: OnboardingAnswers,
  attempts = 5,
): Promise<string> {
  let handle = answers.handle;
  for (let i = 0; i < attempts; i += 1) {
    try {
      await updateOnboardingProfile(client, userId, { ...answers, handle });
      return handle;
    } catch (err) {
      if (!isUniqueViolation(err) || i === attempts - 1) throw err;
      handle = withRandomSuffix(answers.handle);
    }
  }
  /* c8 ignore next */ return handle; // loop either returns or throws
}

/** Partial profile edit (Profilo Evolutivo). RLS enforces owner-only; schema strips unknown keys. */
export async function updateProfile(
  client: AthanorClient,
  userId: string,
  patch: ProfileUpdate,
): Promise<void> {
  const payload = profileUpdateSchema.parse(patch);
  const { error } = await client.from('profiles').update(payload).eq('id', userId);
  if (error) throw error;
}
