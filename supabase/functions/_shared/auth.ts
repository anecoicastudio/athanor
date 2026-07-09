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
 * Service-role gate — verify_jwt=true merely proves a valid project JWT (every member has
 * one); assert the bearer IS the service-role key. Returns the key for onward
 * service-to-service calls (e.g. fan-out → push-dispatch).
 */
export function requireServiceRole(
  req: Request,
): { ok: true; serviceKey: string } | { ok: false; response: Response } {
  const bearer = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!serviceKey || bearer !== serviceKey) return { ok: false, response: error('unauthorized', 401) };
  return { ok: true, serviceKey };
}
