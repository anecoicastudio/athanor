import type { Metadata, Viewport } from 'next';
import { cookies } from 'next/headers';
import { Hanken_Grotesk, EB_Garamond } from 'next/font/google';
import { Analytics } from '@vercel/analytics/next';
import { SpeedInsights } from '@vercel/speed-insights/next';
import { t, type Locale } from '@auria/i18n';
import { semantic } from '@auria/config';
import './globals.css';
import { cn } from '@/lib/utils';
import { SITE_URL } from '@/lib/site';
import { Splash } from '@/components/splash';
import { SmoothScroll } from '@/components/smooth-scroll';
import { PageReveal } from '@/components/page-reveal';
import { LocaleProvider } from '@/components/locale-provider';
import { CookieNotice } from '@/components/cookie-notice';

const hankenGrotesk = Hanken_Grotesk({
  variable: '--font-sans',
  subsets: ['latin'],
  weight: ['400', '600'],
});

/*
 * Display face (DESIGN.md §11, 2026-06-13): EB Garamond — upright for headlines,
 * italic for the dream quotes. Body / UI / labels remain Hanken Grotesk above —
 * as does the plain "AURIA" wordmark (2026-06-13, switched from EB Garamond to
 * match the vertical section labels). (The Greek-Λ wordmark experiment was
 * reverted to plain Latin letters on user request — the Greek subset is no longer
 * required but kept; it's harmless and EB Garamond's Greek is well-matched.)
 */
const ebGaramond = EB_Garamond({
  variable: '--font-eb-garamond',
  subsets: ['latin', 'greek'],
  weight: ['400', '500', '600'],
  style: ['normal', 'italic'],
});

/** Active landing locale from the `auria_locale` cookie (IT canonical default). */
async function getLocale(): Promise<Locale> {
  const value = (await cookies()).get('auria_locale')?.value;
  return value === 'en' ? 'en' : 'it';
}

export const viewport: Viewport = {
  themeColor: semantic.background,
  colorScheme: 'dark',
};

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  const title = `${t('app.name', locale)} — ${t('app.tagline', locale)}`;
  const description = t('landing.meta.description', locale);
  return {
    metadataBase: new URL(SITE_URL),
    title,
    description,
    applicationName: t('app.name', locale),
    keywords: ['Auria', 'community', 'reputazione', 'reputation', 'networking', 'Aura'],
    alternates: { canonical: '/' },
    robots: { index: true, follow: true },
    openGraph: {
      title,
      description,
      url: '/',
      type: 'website',
      locale: locale === 'it' ? 'it_IT' : 'en_US',
      siteName: t('app.name', locale),
    },
    twitter: { card: 'summary_large_image', title, description },
  };
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const locale = await getLocale();
  return (
    <html
      lang={locale}
      className={cn('h-full antialiased font-sans', hankenGrotesk.variable, ebGaramond.variable)}
    >
      <body className="min-h-full flex flex-col">
        <a href="#main" className="skip-link">
          {t('a11y.skip', locale)}
        </a>
        <LocaleProvider initialLocale={locale}>
          <Splash tagline={t('app.tagline', locale)} />
          <PageReveal>
            <SmoothScroll>{children}</SmoothScroll>
          </PageReveal>
          <CookieNotice />
        </LocaleProvider>
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}
