'use client';

import { createBrowserClient } from '@supabase/ssr';
import type { Database, AuriaClient } from '@auria/api';

export function createClient(): AuriaClient {
  // @supabase/ssr 0.6.x instantiates the old 3-generic SupabaseClient while
  // supabase-js ≥2.50 uses 5 generics — same runtime class, same Database
  // schema, so the cast only realigns type parameters. Centralized here so
  // call sites stay cast-free; drop when @supabase/ssr catches up.
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  ) as unknown as AuriaClient;
}
