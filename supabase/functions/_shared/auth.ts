import { createClient, type SupabaseClient, type User } from 'npm:@supabase/supabase-js@2';
import { error } from './respond.ts';

/**
 * Caller gate — identify the end user from the request's JWT via getUser(); identity is
 * NEVER trusted from the body. Also returns the anon-key client bound to the caller's
 * Authorization header so follow-up queries still run under the caller's RLS (second gate).
 */
export async function requireUser(
  req: Request,
): Promise<{ ok: true; user: User; userClient: SupabaseClient } | { ok: false; response: Response }> {
  const authHeader = req.headers.get('Authorization') ?? '';
  const userClient = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } }, auth: { persistSession: false } },
  );
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
 * Service-role gate — verify_jwt=true merely proves a valid project JWT (every member has
 * one); assert the bearer IS the service-role key (timing-safe). Returns the key for
 * onward service-to-service calls (e.g. fan-out → push-dispatch).
 */
export function requireServiceRole(
  req: Request,
): { ok: true; serviceKey: string } | { ok: false; response: Response } {
  const bearer = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!serviceKey || !timingSafeEqual(bearer, serviceKey)) {
    return { ok: false, response: error('unauthorized', 401) };
  }
  return { ok: true, serviceKey };
}
