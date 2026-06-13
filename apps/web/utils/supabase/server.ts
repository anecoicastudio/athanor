import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { cookies } from 'next/headers';
import type { Database, KairaClient } from '@kaira/api';

export async function createClient(): Promise<KairaClient> {
  const cookieStore = await cookies();

  // Cast mirrors utils/supabase/client.ts: @supabase/ssr 0.6.x builds the 3-generic
  // SupabaseClient while supabase-js ≥2.50 expects 5 — same runtime class. Centralizing
  // it here lets server components call @kaira/api functions cast-free.
  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // Called from a Server Component — middleware refreshes sessions.
          }
        },
      },
    },
  ) as unknown as KairaClient;
}
