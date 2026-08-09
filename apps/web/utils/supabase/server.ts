import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import type { Database } from '@athanor/api';
import { supabaseKey } from './key';

/** Read-only Supabase server client carrying the request's cookies; authenticates
 * with the publishable key (legacy anon fallback — see ./key.ts). Its one caller is
 * the waitlist route — public @handle SSR now uses createAnonClient below, which
 * has no cookie jar and so does not force dynamic rendering.
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

/** Read-only, cookie-free Supabase client — effectively an anon-role client.
 *
 * Used by `generateStaticParams()`, `sitemap()`, and the `/@handle` page itself
 * (which also runs on demand for handles created since the last build). Identical
 * to `createClient()` minus the cookie jar, and that is the whole point: `cookies()`
 * throws outside a request scope and otherwise opts the route into dynamic
 * rendering — which is what kept the entire public site server-rendered.
 *
 * Carrying no cookies means no user JWT, so PostgREST resolves the role from the
 * publishable/anon key and the anon policies apply (`profiles_select_anon_public`,
 * `dreams_select_anon_public`). That is exactly what these public pages want, and
 * it removes a real hazard: a page that is now cached must never be rendered with
 * one viewer's session. */
export function createAnonClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url) throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL');
  return createServerClient<Database>(url, supabaseKey(), {
    cookies: {
      getAll() {
        return [];
      },
      setAll() {
        // no-op: nothing to persist during a build
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
          // Called from a Server Component, where cookies are read-only. Nothing
          // refreshes the session on this path any more — proxy.ts used to, but the
          // Cloudflare adapter cannot run Node middleware. An expired token therefore
          // redirects to /admin/login rather than refreshing in place; components/
          // session-keepalive.tsx covers the open-tab case from the client.
        }
      },
    },
  });
}
