import type { Metadata } from 'next';
import { t } from '@athanor/i18n';
import { DEFAULT_LOCALE } from '@/lib/default-locale';
import { APP_RETURN_TARGETS } from '@/lib/app-deeplinks';
import { AppReturnView } from '@/components/app-return-view';

/*
 * `PAYOUT_ONBOARDING_REFRESH_URL` for `create-payout-onboarding` (#418, #246). Account Links
 * are single-use and short-lived; Stripe sends the member here when the link they opened has
 * expired or was already consumed, and expects the platform to mint a fresh one.
 *
 * Minting is the app's job, not this page's — `create-payout-onboarding` is user-callable and
 * derives `profile_id` from `getUser()` (rule 8), so there is no caller identity on the web
 * side to mint against. The hop back into the app is the whole remedy: the organiser lands on
 * the payout screen and taps again, and the function reuses the existing Connect account
 * rather than creating a second one.
 *
 * Static, `dynamic = 'error'`, noindex — see `/app/verify` for why.
 */
export const dynamic = 'error';

export const metadata: Metadata = {
  title: `${t('appReturn.payout.refresh.title', DEFAULT_LOCALE)} — ${t('app.name', DEFAULT_LOCALE)}`,
  description: t('appReturn.payout.refresh.body', DEFAULT_LOCALE),
  robots: { index: false, follow: false },
};

export default function AppPayoutRefreshPage() {
  return (
    <AppReturnView
      target={APP_RETURN_TARGETS.payoutRefresh}
      titleKey="appReturn.payout.refresh.title"
      bodyKey="appReturn.payout.refresh.body"
    />
  );
}
