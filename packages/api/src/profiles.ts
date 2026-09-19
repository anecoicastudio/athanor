import {
  claimableHandleSchema,
  type OnboardingAnswers,
  onboardingAnswersSchema,
  personProfileSchema,
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

/**
 * Own full row via the `get_own_profile` DEFINER RPC — sensitive columns are
 * no longer directly selectable after M10 column-scoping (role-wide grants
 * can't distinguish own rows). Takes no id: the RPC derives identity from
 * auth.uid(), so there is no id to disagree with.
 */
export async function getOwnProfile(client: AthanorClient) {
  const { data, error } = await client.rpc('get_own_profile').maybeSingle();
  if (error) throw error;
  if (!data) return null;
  // profileSchema.parse validates the DB row at the trust boundary and strips extra columns.
  return profileSchema.parse(data);
}

/**
 * Another member's profile via the `get_person_profile` DEFINER RPC (M10):
 * bio/tags/seeking arrive NULL when that field is 'private'. Null result =
 * unknown id, blocked pair, or signed-out.
 */
export async function getProfileById(client: AthanorClient, profileId: string) {
  const { data, error } = await client
    .rpc('get_person_profile', { p_profile_id: profileId })
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return personProfileSchema.parse(data);
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

/**
 * Whether a profile already holds `handle` (#782) — the live check beside the handle field.
 *
 * As far as the CALLER can see: profiles SELECT is members-wide but a blocked pair is
 * RLS-invisible, so a handle held by someone on the other side of a block reads as free here.
 * That is a courtesy check, not the gate — the unique index is, and `claimHandle` surfaces its
 * 23505 for `handleClaimRefusal` to name as taken. Single-row existence probe, no pagination.
 */
export async function isHandleTaken(client: AthanorClient, handle: string): Promise<boolean> {
  const { data, error } = await client
    .from('profiles')
    .select('id')
    .eq('handle', handle)
    .maybeSingle();
  if (error) throw error;
  return data !== null;
}

/**
 * Claim `handle` for the caller's own row (#782) — the first choice after sign-up and every
 * rename from the profile editor alike. Writes that one column and nothing else. The database
 * decides the rest: the unique index, the shape and reserved-word CHECKs, and the 30-day rename
 * cooldown (`profiles_handle_cooldown`). Its refusals propagate untouched for
 * {@link handleClaimRefusal} to name; a malformed or reserved handle never reaches the wire.
 */
export async function claimHandle(
  client: AthanorClient,
  userId: string,
  handle: string,
): Promise<void> {
  const payload = { handle: claimableHandleSchema.parse(handle) };
  const { error } = await client.from('profiles').update(payload).eq('id', userId);
  if (error) throw error;
}

/**
 * The SQLSTATE `profiles_handle_cooldown` refuses a rename with. PostgREST maps a PTxxx code
 * onto that HTTP status (the waitlist throttle's precedent), so the code alone tells it apart;
 * @athanor/core's handle-cooldown.mirror.test pins the trigger to the same literal.
 */
export const HANDLE_COOLDOWN_CODE = 'PT429';

export type HandleClaimRefusal =
  | { reason: 'taken' }
  | { reason: 'reserved' }
  | { reason: 'malformed' }
  /** `opensAt` is the trigger's DETAIL — the ISO instant the next rename opens — or null. */
  | { reason: 'cooldown'; opensAt: string | null };

/**
 * Name a database refusal of a handle write, or `null` when the error is anything else (#782).
 * A refused handle always says why on screen (#769's lesson), so each refusal the database can
 * produce is read here — by the constraint it names, not the bare code: `profiles` carries
 * other CHECKs, and a too-long bio must not be told «questo nome è riservato».
 */
export function handleClaimRefusal(err: unknown): HandleClaimRefusal | null {
  if (typeof err !== 'object' || err === null) return null;
  const { code, message, details } = err as { code?: unknown; message?: unknown; details?: unknown };
  if (typeof code !== 'string' || typeof message !== 'string') return null;
  if (code === '23505' && message.includes('"profiles_handle_key"')) return { reason: 'taken' };
  if (code === '23514' && message.includes('"profiles_handle_not_reserved"')) {
    return { reason: 'reserved' };
  }
  if (code === '23514' && message.includes('"profiles_handle_check"')) {
    return { reason: 'malformed' };
  }
  if (code === HANDLE_COOLDOWN_CODE && message === 'handle_cooldown') {
    const opensAt =
      typeof details === 'string' && !Number.isNaN(Date.parse(details)) ? details : null;
    return { reason: 'cooldown', opensAt };
  }
  return null;
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
