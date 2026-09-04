import { LandingClient } from '@/components/landing-client';

/**
 * The landing route — a Server Component (#335). The page module ships no JS of its own,
 * and anything added here later (a server read, a section that needs no locale) stays on
 * the server by default instead of inheriting `'use client'` from line 1 the way the whole
 * 377-line tree used to. The narrative lives in components/landing-view.tsx and reaches the
 * client through the thin shell in landing-client.tsx, the same shape /@handle and
 * /event/{id} use: the IT/EN toggle is a post-hydration switch (lib/default-locale.ts), and
 * the copy has to follow it.
 */
export default function Home() {
  return <LandingClient />;
}
