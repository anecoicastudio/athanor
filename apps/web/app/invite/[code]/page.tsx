import type { Metadata } from 'next';
import { t } from '@athanor/i18n';
import { DEFAULT_LOCALE } from '@/lib/default-locale';
import { InviteView } from '@/components/invite-view';

/**
 * Personal invite landing — reached via a referral link shared from the mobile
 * app (`invites.referral_code`), never via the universal-link deep-link flow
 * (that opens the app directly and never renders a web page). Purely
 * presentational, like `/privacy` and `/terms`: no Supabase, no auth, no lookup
 * against the `invites` table (web app hard rule). The code param is only ever
 * echoed back to the invitee as an identity cue while they install the app —
 * redemption itself happens when they reopen this same link on their device
 * after installing (the app stashes the code and redeems it against the
 * signed-up account; there is no in-app field to type it into). The code is
 * never validated against the database here, just shape-checked so junk input
 * can't be reflected onto the page.
 *
 * Cannot prerender (the codes are arbitrary), but the render is trivial and the
 * page is noindex, so it costs a bare template render and no data access.
 */
const CODE_RE = /^[A-Z0-9]{6,12}$/;

function sanitizeCode(raw: string): string | null {
  const upper = raw.toUpperCase();
  return CODE_RE.test(upper) ? upper : null;
}

export const metadata: Metadata = {
  title: `${t('invite.landing.title', DEFAULT_LOCALE)} — ${t('app.name', DEFAULT_LOCALE)}`,
  description: t('invite.landing.body', DEFAULT_LOCALE),
  // Ephemeral personal referral links — keep them out of search results.
  robots: { index: false, follow: false },
};

export default async function InvitePage({ params }: { params: Promise<{ code: string }> }) {
  const { code: rawCode } = await params;
  return <InviteView code={sanitizeCode(rawCode)} />;
}
