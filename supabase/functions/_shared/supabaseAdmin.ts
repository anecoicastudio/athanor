import { createClient } from 'npm:@supabase/supabase-js@2';
import { secretKey } from './keys.ts';

/**
 * Service-role client — bypasses RLS for privileged writers (money tables, GDPR jobs, score
 * engine). Never exposed to clients.
 *
 * `secretKey()` returns a new-style `sb_secret_…` when the platform injects one and the legacy
 * service_role JWT otherwise; both authorize the same way (Postgres BYPASSRLS for the former,
 * the service_role claim for the latter).
 */
export const supabaseAdmin = () =>
  createClient(Deno.env.get('SUPABASE_URL')!, secretKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
