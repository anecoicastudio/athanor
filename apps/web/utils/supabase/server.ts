import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import type { Database } from '@athanor/api';
import { supabaseKey } from './key';

/** Read-only Supabase server client for public @handle SSR (RLS-gated); authenticates
 * with the publishable key (legacy anon fallback — see ./key.ts). */
export async function createClient() {
  const cookieStore = await cookies();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url) throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL');
  return createServerClient<Database>(url, supabaseKey(), {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll() {
        // no-op: public read-only pages never write auth cookies
      },
    },
  });
}

/** Authed Supabase server client for /admin (reads + writes the session cookie). */
export async function createAuthedClient() {
  const cookieStore = await cookies();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url) throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL');
  return createServerClient<Database>(url, supabaseKey(), {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // called from a Server Component — proxy refreshes the session instead
        }
      },
    },
  });
}
