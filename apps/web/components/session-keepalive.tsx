'use client';

import { useEffect } from 'react';
import { createClient } from '@/utils/supabase/client';

/**
 * Keeps a foregrounded admin tab's Supabase session fresh.
 *
 * This used to be proxy.ts's job — `updateSession()` refreshed the auth cookies on
 * every /admin request. The Cloudflare adapter cannot run Node middleware
 * (@opennextjs/cloudflare 1.20.2 fails the build outright on Next 16's proxy.ts),
 * so the proxy is gone.
 *
 * No authorization was lost with it: every admin surface gates itself — the
 * dashboard layout re-checks getUser() + app_metadata.role, the waitlist export
 * route has its own 403, the verdict Server Action re-checks before the RPC, and
 * is_admin() gates the database.
 *
 * What this recovers is narrower than what the proxy did, and the difference
 * matters. The browser client stores its session in cookies, so an auto-refresh
 * writes the same `sb-*` cookies the server's createAuthedClient() reads — an open
 * tab therefore keeps working past the 1 h token TTL. It does NOT cover a cold
 * request: opening /admin in a new tab after the token expired runs the Server
 * Component layout with the stale cookie, GoTrue 401s, and the layout redirects to
 * /admin/login before any client JS mounts. The server cannot refresh there either,
 * because createAuthedClient's setAll is a no-op in a Server Component. That case
 * still costs a sign-in. It fails closed, which is the right direction.
 *
 * There is deliberately no cleanup. `createBrowserClient` returns a module-level
 * singleton shared by the whole app, and `stopAutoRefresh()` also removes the
 * visibility-change callback permanently, with nothing to re-register it — so an
 * unmount (or React Strict Mode's double-invoke in dev) would disable refresh for
 * the rest of the page's life, defeating the component. auth-js manages the ticker
 * itself, including stopping it while the tab is hidden.
 */
export function SessionKeepalive() {
  useEffect(() => {
    // Touch the session on mount so a tab restored after expiry refreshes now
    // rather than on the next navigation. Idempotent under Strict Mode.
    void createClient().auth.getSession();
  }, []);

  return null;
}
