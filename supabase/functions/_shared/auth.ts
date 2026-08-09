import { createClient, type SupabaseClient, type User } from 'npm:@supabase/supabase-js@2';
import { error } from './respond.ts';
import { type EnvPort, publishableKey, secretKey, secretKeys } from './keys.ts';

/**
 * Caller gate — identify the end user from the request's JWT via getUser(); identity is
 * NEVER trusted from the body. Also returns the publishable-key client bound to the caller's
 * Authorization header so follow-up queries still run under the caller's RLS (second gate).
 *
 * The publishable key rides the `apikey` header (supabase-js sets it from the 2nd createClient
 * argument) while the caller's own JWT stays on Authorization — which is both what the platform
 * requires for new-style keys and what lets these functions keep `verify_jwt = true`.
 */
export async function requireUser(
  req: Request,
): Promise<
  { ok: true; user: User; userClient: SupabaseClient } | { ok: false; response: Response }
> {
  const authHeader = req.headers.get('Authorization') ?? '';
  const userClient = createClient(Deno.env.get('SUPABASE_URL')!, publishableKey(), {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });
  const { data, error: userErr } = await userClient.auth.getUser();
  if (userErr || !data.user) return { ok: false, response: error('unauthorized', 401) };
  return { ok: true, user: data.user, userClient };
}

/**
 * Constant-time string equality — a plain `!==` short-circuits at the first differing
 * byte, letting an attacker probe the service-role key prefix through response timing.
 * XOR-accumulates over the full longer length; only the final result branches.
 */
export function timingSafeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const ab = enc.encode(a);
  const bb = enc.encode(b);
  let diff = ab.length ^ bb.length;
  const len = Math.max(ab.length, bb.length);
  for (let i = 0; i < len; i++) {
    diff |= (ab[i] ?? 0) ^ (bb[i] ?? 0);
  }
  return diff === 0;
}

/**
 * Service-role gate — assert the caller presented one of this project's secret keys.
 *
 * This is the ONLY gate on the internal functions. Secret keys are not JWTs, so the platform's
 * `verify_jwt` check cannot validate one and those functions declare `verify_jwt = false`
 * (config.toml, asserted by config-invariants.test.ts). That makes them reachable
 * unauthenticated at the network layer: this must stay the first statement in every handler,
 * before any I/O, env read, or body parse.
 *
 * Reads `apikey` first — where new-style keys belong — then Authorization, so the pg_net
 * callers can move to the new header before or after this deploys, in either order.
 * Compares against every injected secret key, OR-accumulating without an early exit: a
 * `break` on match would reintroduce exactly the timing side-channel timingSafeEqual exists
 * to close. Returns the function's OWN key for onward calls, never the presented one.
 */
export function requireServiceRole(
  req: Request,
  env?: EnvPort,
): { ok: true; secretKey: string } | { ok: false; response: Response } {
  const presented =
    req.headers.get('apikey') ||
    (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  const accepted = secretKeys(env);

  let matched = false;
  for (const candidate of accepted) matched = timingSafeEqual(presented, candidate) || matched;
  if (!presented || !matched) return { ok: false, response: error('unauthorized', 401) };

  return { ok: true, secretKey: secretKey(env) };
}
