import type { Metadata } from 'next';
import { t } from '@athanor/i18n';
import { DEFAULT_LOCALE } from '@/lib/default-locale';
import { APP_RETURN_TARGETS } from '@/lib/app-deeplinks';
import { AppReturnView } from '@/components/app-return-view';

/*
 * `PAYOUT_ONBOARDING_RETURN_URL` for `create-payout-onboarding` (#418, #246). Stripe Account
 * Links reject non-HTTPS URLs in live mode, so the organiser cannot be sent straight back to
 * `athanor://` the way Checkout's `success_url` sends them — the function has always read
 * this URL from env for exactly that reason, and answers `500 payout onboarding not
 * configured` until it is set.
 *
 * Stripe sends the member here when they leave the Connect onboarding form, which is NOT the
 * same as finishing it: the form can be exited part-way and the return still fires. The copy
 * therefore promises nothing about the outcome. What is true either way is that the
 * capability flags on `payout_accounts` are maintained only by the webhook's `account.updated`
 * arm (rule 6), so this page has nothing to report even when the form was completed.
 *
 * Static, `dynamic = 'error'`, noindex — see `/app/verify` for why.
 */
export const dynamic = 'error';

export const metadata: Metadata = {
  title: `${t('appReturn.payout.return.title', DEFAULT_LOCALE)} — ${t('app.name', DEFAULT_LOCALE)}`,
  description: t('appReturn.payout.return.body', DEFAULT_LOCALE),
  robots: { index: false, follow: false },
};

export default function AppPayoutReturnPage() {
  return (
    <AppReturnView
      target={APP_RETURN_TARGETS.payoutReturn}
      titleKey="appReturn.payout.return.title"
      bodyKey="appReturn.payout.return.body"
    />
  );
}
