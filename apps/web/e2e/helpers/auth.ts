import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * Magic-link auth is e-mail driven, which is hostile to headless tests. Instead
 * of polling Inbucket, we use the service-role admin API to mint the same
 * token the e-mail would carry, then drive the real /auth/confirm route with it.
 * Deterministic, no mailbox, identical to the production verifyOtp path.
 *
 * Needs NEXT_PUBLIC_SUPABASE_URL (.env.local) + SUPABASE_SERVICE_ROLE_KEY
 * (.env.test). The service-role key is local-stack only and never committed.
 */
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceRole) {
  throw new Error(
    'E2E auth needs NEXT_PUBLIC_SUPABASE_URL (.env.local) and SUPABASE_SERVICE_ROLE_KEY (.env.test). Run `supabase status` for the local values.',
  );
}

const admin: SupabaseClient = createClient(url, serviceRole, {
  auth: { autoRefreshToken: false, persistSession: false },
});

/**
 * Create a confirmed user. The auth.users trigger seeds an empty profiles row,
 * so the user lands incomplete → the proxy routes them into onboarding.
 */
export async function createConfirmedUser(email: string): Promise<string> {
  const { data, error } = await admin.auth.admin.createUser({ email, email_confirm: true });
  if (error) throw error;
  return data.user.id;
}

/** The magic-link token_hash for /auth/confirm — the stand-in for clicking the e-mail. */
export async function magicTokenHash(email: string): Promise<string> {
  const { data, error } = await admin.auth.admin.generateLink({ type: 'magiclink', email });
  if (error) throw error;
  const hash = data.properties?.hashed_token;
  if (!hash) throw new Error('generateLink returned no hashed_token');
  return hash;
}

/** Best-effort teardown so reruns start clean. */
export async function deleteUser(userId: string): Promise<void> {
  await admin.auth.admin.deleteUser(userId);
}
