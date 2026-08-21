'use client';

import { LandingView } from '@/components/landing-view';
import { useLocale } from '@/components/locale-provider';

/**
 * Client shell for the landing — the same shape as public-profile-client.tsx. The page is
 * prerendered as IT and the IT/EN toggle is a post-hydration switch (lib/default-locale.ts),
 * so the one thing that has to run on the client is reading the live locale and handing it
 * to the view. Everything else about the landing is a function of that prop, and the route
 * module itself (app/page.tsx) stays a Server Component (#335).
 */
export function LandingClient() {
  const { locale } = useLocale();
  return <LandingView locale={locale} />;
}
