import type { Metadata } from 'next';
import { t } from '@athanor/i18n';
import { DEFAULT_LOCALE } from '@/lib/default-locale';
import { APP_RETURN_TARGETS } from '@/lib/app-deeplinks';
import { AppReturnView } from '@/components/app-return-view';

/*
 * Stripe Identity's `return_url` (#418, spun out of #417). Identity validates that URL and
 * takes http(s) only — `athanor://verify?status=complete` came back 400 `url_invalid`, which
 * is why #417 dropped the param rather than shipping a broken one. This page is the https
 * destination that gives it back: `IDENTITY_RETURN_BASE` on the edge function points here,
 * and `create-verification-session` needs no further change (its `stripeReturnUrl` guard
 * already sends the param only when the built URL is http(s)).
 *
 * Nothing here reads the outcome. Identity is asynchronous — the document is reviewed after
 * the browser closes — so `profiles.identity_verified` has always been flipped by webhook W9
 * over realtime, never by this redirect. The redirect's whole job is closing the sheet.
 *
 * Static like `/post`, and `dynamic = 'error'` for the same reason: a future edit reaching
 * for a request-time API would turn every return into a per-request Worker render, so make
 * that a build failure. Stripe appends its own query params on the way in; they change
 * nothing about what is served.
 *
 * noindex — it is a hand-off, not a page anyone should arrive at from search.
 */
export const dynamic = 'error';

export const metadata: Metadata = {
  title: `${t('appReturn.verify.title', DEFAULT_LOCALE)} — ${t('app.name', DEFAULT_LOCALE)}`,
  description: t('appReturn.verify.body', DEFAULT_LOCALE),
  robots: { index: false, follow: false },
};

export default function AppVerifyReturnPage() {
  return (
    <AppReturnView
      target={APP_RETURN_TARGETS.verify}
      titleKey="appReturn.verify.title"
      bodyKey="appReturn.verify.body"
    />
  );
}
