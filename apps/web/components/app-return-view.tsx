'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { t, type MessageKey } from '@athanor/i18n';
import { useLocale } from '@/components/locale-provider';
import { AthanorWordmark } from '@/components/athanor-wordmark';
import { buttonVariants } from '@/components/ui/button';

/**
 * Body of the `/app/*` hand-off pages (#418) — the https half of a Stripe return.
 *
 * Stripe Identity's `return_url` and Account Links' `return_url`/`refresh_url` take an
 * http(s) URL only (Checkout is the odd one out and accepts `athanor://` directly), so a
 * member finishing one of those flows lands on the web instead of back in the app. This
 * component is the hop: it forwards to the `athanor://` scheme so
 * `WebBrowser.openAuthSessionAsync` intercepts the navigation and closes the sheet.
 *
 * `target` is a module-level literal owned by the route that renders this — never a query
 * param, never anything reflected from the request. That is deliberate: a forwarder that
 * takes its destination from the URL is an open redirect, and one pointing at a custom
 * scheme is an open redirect into whatever app claims it. The allowlist here is the route
 * table (three static routes, three fixed targets), which is the strongest form of it and
 * costs nothing — the copy has to differ per destination anyway.
 *
 * The visible CTA is not decoration. The automatic hop is blocked whenever the navigation
 * has no user gesture behind it (several in-app browsers refuse a scheme change outright),
 * and the app may not be installed at all — in both cases the tappable link is the only way
 * out of this page.
 */
export function AppReturnView({
  target,
  titleKey,
  bodyKey,
}: {
  /** literal `athanor://…` deep link — see the note above; never request-derived */
  target: string;
  titleKey: MessageKey;
  bodyKey: MessageKey;
}) {
  const { locale } = useLocale();

  useEffect(() => {
    // Assignment rather than replace(): handing a custom scheme to the OS is the
    // well-trodden path, and leaving the history entry is what lets the browser's
    // back button return here if the app never takes over.
    window.location.href = target;
  }, [target]);

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
          {t(titleKey, locale)}
        </h1>
        <p className="max-w-md text-lg leading-relaxed text-muted-foreground">
          {t(bodyKey, locale)}
        </p>
      </div>

      <div className="flex flex-col items-center gap-4">
        <a href={target} className={buttonVariants({ variant: 'primary' })}>
          {t('appReturn.cta', locale)}
        </a>
        <p className="text-sm text-muted-foreground">{t('appReturn.hint', locale)}</p>
      </div>

      <Link
        href="/"
        className="text-sm font-semibold underline underline-offset-4 transition-opacity hover:opacity-80"
      >
        {t('notFound.home', locale)}
      </Link>
    </main>
  );
}
