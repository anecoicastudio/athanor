import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

// Erasure cascade step (1): revoke every live session of the subject, BY USER ID.
//
// Split out of index.ts so it can be tested. index.ts is a `Deno.serve` shell and nothing in the
// suite ever executed it — which is exactly how #542 survived: the port was wired to
// `db.auth.admin.signOut(profileId, 'global')`, a call that takes «A valid, logged-in JWT» and
// sends its first argument as the `Authorization` bearer. GoTrue 401'd on every run, the loop
// recorded a failed step, and every live erasure landed `failed` with the sessions still open.
// The unit suite stayed green because the port was mocked at precisely that boundary.
//
// There is no by-id admin call to move to: auth-js exposes getUserById / updateUserById /
// deleteUser (plus MFA-factor and passkey deletes) and GoTrue's `/admin` router registers no
// session route at all. deleteUser would cascade the sessions away, but that is the legal-gated
// step (4) — the step that may not run yet — so step (1) has to stand alone. The revoke
// therefore goes where the sessions live: `public.gdpr_revoke_sessions` (20260825074614), a
// SECURITY DEFINER function running GoTrue's own global-logout statement.

/** The RPC that does the revoke. Named once; ./revoke.test.ts pins the spelling. */
export const REVOKE_SESSIONS_RPC = 'gdpr_revoke_sessions';

/**
 * Revoke by profile id. Reports failure the way the whole PostgREST surface does — a resolved
 * `{ error }` — so the loop's existing `if (result?.error)` reads it unchanged. A rejection is
 * the caller's to catch (./logic.ts does).
 *
 * The RPC's return value — how many sessions were revoked — is deliberately dropped HERE rather
 * than threaded onward. The loop's decision at step (1) is binary (degraded or not), and the
 * job's response body is #515's report on what the DEPLOYMENT can do, not per-request
 * accounting; a count in it would be a per-subject number in a payload that is otherwise true of
 * a zero-request run. The count still has its consumers — an operator calling the RPC directly,
 * and 0134, which asserts it — so nothing is lost by not carrying it through a caller that
 * cannot act on it. Zero is a success either way, and that is the only thing the loop must not
 * get wrong (#515/#516: `failed` means a step actually failed).
 */
export const sessionRevoker =
  (db: SupabaseClient) =>
  async (profileId: string): Promise<{ error?: unknown } | null> => {
    const { error } = await db.rpc(REVOKE_SESSIONS_RPC, { p_user_id: profileId });
    return { error };
  };
