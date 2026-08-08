import { resolveSupabaseKey } from '@athanor/api';

/**
 * Both reads MUST stay literal member expressions — Next inlines NEXT_PUBLIC_* at build
 * time, so a computed lookup silently yields undefined in the browser bundle.
 * Evaluated in browser, server, and edge (middleware) contexts — keep it pure.
 */
export function supabaseKey(): string {
  return resolveSupabaseKey(
    {
      publishable: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
      anon: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    },
    {
      publishable: 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
      anon: 'NEXT_PUBLIC_SUPABASE_ANON_KEY',
    },
  );
}
