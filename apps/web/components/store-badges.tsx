import Image from 'next/image';
import type { Locale } from '@athanor/i18n';
import { t } from '@athanor/i18n';
import { GET_APPLE_PATH, PLAY_URL } from '@/lib/store-links';
import { cn } from '@/lib/utils';

/**
 * The two store badges — what replaced the waitlist form once the app shipped (#269).
 *
 * Third-party artwork, used as supplied: Apple's from the App Store Marketing Resources badge
 * generator, Google's from the Google Play badge page, both fetched 2026-10-03 in IT and EN.
 * Both vendors forbid restyling, so these are never recoloured, tinted or given a glow — the
 * one place the site shows a mark that is not from the Athanor set (docs/DESIGN.md §11).
 * Google's PNGs are trimmed to the badge edge; the gap below is the clear space.
 *
 * The App Store badge links to `/get`, never to a listing: a listing URL names one country's
 * storefront (`lib/store-links.ts`). Plain anchors, not `Link` — `/get` answers with a
 * redirect to another origin, which is a navigation, not a route to prefetch.
 */
const BADGE_HEIGHT = 48;
const ART = {
  it: { apple: [119.66407, 40], google: [646, 192] },
  en: { apple: [119.66407, 40], google: [564, 168] },
} as const satisfies Record<Locale, Record<'apple' | 'google', readonly [number, number]>>;

const width = ([w, h]: readonly [number, number]) => Math.round((w / h) * BADGE_HEIGHT);

export function StoreBadges({ locale, className }: { locale: Locale; className?: string }) {
  const art = ART[locale];
  return (
    <div className={cn('flex flex-wrap items-center justify-center gap-4', className)}>
      <a href={GET_APPLE_PATH} className="transition-opacity hover:opacity-80">
        <Image
          src={`/badges/app-store-${locale}.svg`}
          alt={t('landing.download.appStoreName', locale)}
          width={width(art.apple)}
          height={BADGE_HEIGHT}
        />
      </a>
      <a href={PLAY_URL} className="transition-opacity hover:opacity-80">
        <Image
          src={`/badges/google-play-${locale}.png`}
          alt={t('landing.download.googlePlayName', locale)}
          width={width(art.google)}
          height={BADGE_HEIGHT}
        />
      </a>
    </div>
  );
}
