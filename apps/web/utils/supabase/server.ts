import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import type { Database } from '@athanor/api';
import { supabaseKey } from './key';

/** Read-only Supabase server client for public @handle SSR (RLS-gated); authenticates
 * with the publishable key (legacy anon fallback — see ./key.ts).
 *
 * `forwardedFor` exists for the waitlist throttle (issue #23) and is the whole reason that
 * trigger can key on a visitor at all. This client runs INSIDE a Vercel function, so the
 * request PostgREST receives is the function's, not the browser's — `request.headers` would
 * otherwise carry the function's egress IP and turn a per-visitor budget into a site-wide one,
 * with every regional visitor throttling the others off. Pass the address the Next route read
 * from its own request and the trigger sees the visitor.
 *
 * It is a per-request value, so it must never be hoisted into a module-level client. */
export async function createClient(forwardedFor?: string) {
  const cookieStore = await cookies();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url) throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL');
  return createServerClient<Database>(url, supabaseKey(), {
    ...(forwardedFor ? { global: { headers: { 'x-forwarded-for': forwardedFor } } } : {}),
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
