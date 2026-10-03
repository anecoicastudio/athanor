'use client';

import Link from 'next/link';
import { t } from '@athanor/i18n';
import { useLocale } from '@/components/locale-provider';
import { AthanorWordmark, BrandText } from '@/components/athanor-wordmark';
import { StoreBadges } from '@/components/store-badges';
import { EEA_STOREFRONTS, appStoreUrl, type StorePlatform } from '@/lib/store-links';

/**
 * What `/get` shows when it cannot pick a store for the visitor: a desktop, or an Apple device
 * connecting from a country with no Athanor storefront (or from one Cloudflare could not name).
 *
 * The picker is the part that matters. `/get` chooses a storefront from where the connection
 * is, and Apple serves a listing by where the Apple ID is from; a traveller or a VPN makes the
 * two disagree, and the App Store then answers «not available» with no way forward. This is the
 * way forward. Country names come from `Intl.DisplayNames`, not the catalog — 29 names in two
 * languages the platform already knows.
 */
export function GetView({ platform }: { platform: StorePlatform }) {
  const { locale } = useLocale();
  const names = new Intl.DisplayNames([locale], { type: 'region' });
  const storefronts = EEA_STOREFRONTS.map((code) => ({
    code,
    name: names.of(code.toUpperCase()) ?? code.toUpperCase(),
  })).sort((a, b) => a.name.localeCompare(b.name, locale));

  return (
    <main
      id="main"
      className="mx-auto flex min-h-screen max-w-2xl flex-col items-center justify-center gap-10 px-6 py-24 text-center text-foreground"
    >
      <Link href="/" aria-label={t('app.name', locale)}>
        <AthanorWordmark className="text-sm" />
      </Link>

      <div className="flex flex-col items-center gap-4">
        <h1 className="max-w-xl font-display text-4xl font-medium leading-snug tracking-tight md:text-5xl">
          <BrandText text={t('landing.download.title', locale)} />
        </h1>
        <p className="max-w-md text-lg leading-relaxed text-muted-foreground">
          {t('get.body', locale)}
        </p>
      </div>

      {platform === 'unknown' ? <StoreBadges locale={locale} /> : null}

      <section className="flex flex-col items-center gap-4 border-t border-border pt-10">
        <h2 className="max-w-md font-display text-2xl font-medium leading-snug tracking-tight">
          {t('get.picker.title', locale)}
        </h2>
        <p className="max-w-sm text-base leading-relaxed text-muted-foreground">
          {t('get.picker.body', locale)}
        </p>
        <ul className="flex max-w-xl flex-wrap justify-center gap-x-5 gap-y-3 pt-2 text-sm">
          {storefronts.map(({ code, name }) => (
            <li key={code}>
              <a
                href={appStoreUrl(code)}
                className="underline underline-offset-4 transition-opacity hover:opacity-80"
              >
                {name}
              </a>
            </li>
          ))}
        </ul>
      </section>

      <Link
        href="/"
        className="text-sm font-semibold underline underline-offset-4 transition-opacity hover:opacity-80"
      >
        {t('notFound.home', locale)}
      </Link>
    </main>
  );
}
