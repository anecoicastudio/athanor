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
  statCounts: (id: string) => ['profiles', id, 'stat-counts'] as const,
};

export async function getOwnProfile(client: AthanorClient, userId: string) {
  const { data, error } = await client.from('profiles').select('*').eq('id', userId).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  // profileSchema.parse validates the DB row at the trust boundary and strips extra columns.
  return profileSchema.parse(data);
}

/** Read another member's profile row (authenticated members-wide RLS). Null if unreachable. */
export async function getProfileById(client: AthanorClient, profileId: string) {
  const { data, error } = await client
    .from('profiles')
    .select('*')
    .eq('id', profileId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return profileSchema.parse(data);
}

/**
 * Resolve an @handle deep link to its profile id (P4.3). Members-wide profiles
 * SELECT (blocked pairs are RLS-invisible via athanor.not_blocked) — null means
 * unknown handle OR not visible to the caller; the screen treats both as
 * «profilo non disponibile». Single-row lookup, no pagination (rule #9 n/a).
 */
export async function getProfileIdByHandle(
  client: AthanorClient,
  handle: string,
): Promise<string | null> {
  const { data, error } = await client
    .from('profiles')
    .select('id')
    .eq('handle', handle)
    .maybeSingle();
  if (error) throw error;
  return data?.id ?? null;
}

export type ProfileStatCounts = {
  collabsCount: number;
  eventsCount: number;
};

/**
 * Stat-line counts (collabs completed as helper, distinct events attended) for
 * any profile — the `profile_stat_counts` DEFINER RPC, because the source
 * tables are party/holder-scoped under RLS. Zero rows (blocked either way, or
 * unknown id) coalesce to zeros.
 */
export async function getProfileStatCounts(
  client: AthanorClient,
  profileId: string,
): Promise<ProfileStatCounts> {
  const { data, error } = await client
    .rpc('profile_stat_counts', { p_profile_id: profileId })
    .maybeSingle();
  if (error) throw error;
  return {
    collabsCount: data?.collabs_count ?? 0,
    eventsCount: data?.events_count ?? 0,
  };
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
