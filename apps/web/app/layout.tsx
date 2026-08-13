import type { Metadata, Viewport } from 'next';
import Script from 'next/script';
import localFont from 'next/font/local';
import { t } from '@athanor/i18n';
import { semantic } from '@athanor/config';
import './globals.css';
import { cn } from '@/lib/utils';
import { SITE_URL } from '@/lib/site';
import { DEFAULT_LOCALE } from '@/lib/default-locale';
import { SkipLink } from '@/components/skip-link';
import { RouteSplash } from '@/components/route-splash';
import { SmoothScroll } from '@/components/smooth-scroll';
import { PageReveal } from '@/components/page-reveal';
import { LocaleProvider } from '@/components/locale-provider';
import { CookieNotice } from '@/components/cookie-notice';

/*
 * Self-hosted (next/font/local), not next/font/google: in dev mode the google
 * loader fetches from fonts.googleapis.com at compile time, and a stalled runner
 * connection kept the dev server from ever answering Playwright's webServer probe
 * (issue #328 — the recurring `web e2e` red). The committed files under ./fonts/
 * are Google's own latin-subset variable woff2 for the same two faces, so nothing
 * changes visually; the network dependency just disappears, in prod builds too.
 */
const hankenGrotesk = localFont({
  src: [{ path: './fonts/hanken-grotesk-latin.woff2', weight: '100 900', style: 'normal' }],
  variable: '--font-sans',
});

/*
 * Display face (DESIGN.md §11, 2026-06-13): EB Garamond — upright for headlines,
 * italic for the dream quotes. Body / UI / labels remain Hanken Grotesk above —
 * as does the plain "ATHANOR" wordmark (2026-06-13, switched from EB Garamond to
 * match the vertical section labels). (The Greek subset the reverted Greek-Λ
 * wordmark experiment used was dropped with the move to self-hosting — local
 * fonts carry no per-script unicode-range splitting, and nothing renders Greek.)
 */
const ebGaramond = localFont({
  src: [
    { path: './fonts/eb-garamond-latin.woff2', weight: '400 800', style: 'normal' },
    { path: './fonts/eb-garamond-latin-italic.woff2', weight: '400 800', style: 'italic' },
  ],
  variable: '--font-eb-garamond',
  adjustFontFallback: 'Times New Roman',
});

export const viewport: Viewport = {
  themeColor: semantic.background,
  colorScheme: 'dark',
};

/*
 * Static, not generateMetadata(): reading the locale cookie here made every page
 * dynamic, which is why prerender-manifest.json had no routes at all. Crawlers
 * carry no locale cookie, so they only ever saw the IT copy this now hardcodes.
 */
const title = `${t('app.name', DEFAULT_LOCALE)} — ${t('app.tagline', DEFAULT_LOCALE)}`;
const description = t('landing.meta.description', DEFAULT_LOCALE);

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title,
  description,
  applicationName: t('app.name', DEFAULT_LOCALE),
  keywords: ['Athanor', 'community', 'reputazione', 'reputation', 'networking', 'Aura'],
  alternates: { canonical: '/' },
  robots: { index: true, follow: true },
  openGraph: {
    title,
    description,
    url: '/',
    type: 'website',
    locale: 'it_IT',
    siteName: t('app.name', DEFAULT_LOCALE),
  },
  twitter: { card: 'summary_large_image', title, description },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang={DEFAULT_LOCALE}
      className={cn('h-full antialiased font-sans', hankenGrotesk.variable, ebGaramond.variable)}
    >
      <body className="min-h-full flex flex-col">
        {/* Both of these read the live locale from context rather than taking a
            server-rendered string, or the chrome would stay Italian around
            English content after the toggle. */}
        <LocaleProvider>
          <SkipLink />
          <RouteSplash />
          <PageReveal>
            <SmoothScroll>{children}</SmoothScroll>
          </PageReveal>
          <CookieNotice />
        </LocaleProvider>
        {/*
          Cloudflare Web Analytics — cookieless and aggregate, as the privacy page
          says. Cloudflare only auto-injects this beacon for a zone it proxies, and
          a *.workers.dev host is not one, so it has to be mounted by hand.

          The env read must be a literal member expression: the bundler substitutes
          NEXT_PUBLIC_* by matching the source text, so a computed lookup silently
          yields undefined (see utils/supabase/key.ts). Absent token → no beacon,
          which is what local dev and preview builds want anyway.
        */}
        {process.env.NEXT_PUBLIC_CF_BEACON_TOKEN ? (
          <Script
            src="https://static.cloudflareinsights.com/beacon.min.js"
            strategy="afterInteractive"
            data-cf-beacon={JSON.stringify({ token: process.env.NEXT_PUBLIC_CF_BEACON_TOKEN })}
          />
        ) : null}
      </body>
    </html>
  );
}
