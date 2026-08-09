'use client';

import { usePathname } from 'next/navigation';
import { t } from '@athanor/i18n';
import { Splash } from '@/components/splash';
import { useLocale } from '@/components/locale-provider';

/**
 * Gates the splash intro to the landing route. The splash (components/splash.tsx)
 * is the landing's entrance moment, not global chrome — without this it replays on
 * every route, including the legal pages reached by full page loads (user request
 * 2026-06-13: no animation on /privacy, /terms). Rendered where <Splash> used to
 * sit in the root layout — outside <SmoothScroll>, so Lenis' transform can't break
 * its fixed-overlay coverage, and SSR still paints it over the first frame on home
 * (on a legal-page load the server pathname isn't '/', so nothing renders).
 */
export function RouteSplash() {
  const pathname = usePathname();
  const { locale } = useLocale();
  if (pathname !== '/') return null;
  return <Splash tagline={t('app.tagline', locale)} />;
}
