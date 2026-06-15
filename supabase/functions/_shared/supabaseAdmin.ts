import { createClient } from 'npm:@supabase/supabase-js@2';

/** Service-role client — the ONLY writer of money tables (bypasses RLS). Never exposed to clients. */
export const supabaseAdmin = () =>
  createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
