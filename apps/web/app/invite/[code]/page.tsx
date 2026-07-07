import type { Metadata } from 'next';
import Link from 'next/link';
import { t } from '@athanor/i18n';
import { getLocale } from '@/lib/get-locale';
import { AthanorWordmark, BrandText } from '@/components/athanor-wordmark';
import { DeviceMockup } from '@/components/device-mockup';
import { WaitlistForm } from '@/components/waitlist-form';

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
 */
const CODE_RE = /^[A-Z0-9]{6,12}$/;

function sanitizeCode(raw: string): string | null {
  const upper = raw.toUpperCase();
  return CODE_RE.test(upper) ? upper : null;
}

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  return {
    title: `${t('invite.landing.title', locale)} — ${t('app.name', locale)}`,
    description: t('invite.landing.body', locale),
    // Ephemeral personal referral links — keep them out of search results.
    robots: { index: false, follow: false },
  };
}

export default async function InvitePage({ params }: { params: Promise<{ code: string }> }) {
  const { code: rawCode } = await params;
  const locale = await getLocale();
  const code = sanitizeCode(rawCode);

  return (
    <main
      id="main"
      className="mx-auto flex min-h-screen max-w-2xl flex-col items-center gap-10 px-6 py-24 text-center text-foreground"
    >
      <Link href="/" aria-label={t('app.name', locale)}>
        <AthanorWordmark className="text-sm" />
      </Link>

      <div className="flex flex-col items-center gap-4">
        <h1 className="max-w-xl font-display text-4xl font-medium leading-snug tracking-tight md:text-5xl">
          {t('invite.landing.title', locale)}
        </h1>
        <p className="max-w-md text-lg leading-relaxed text-muted-foreground">
          {t('invite.landing.body', locale)}
        </p>
      </div>

      {code && (
        <code className="rounded-lg border border-border bg-card/40 px-6 py-3 font-mono text-xl tracking-[0.3em] text-foreground">
          {code}
        </code>
      )}

      <div className="flex flex-col items-center gap-10 pt-6">
        <DeviceMockup
          src="/mobile-image-2.png"
          alt={t('landing.preview.alt', locale)}
          className="w-[280px] md:w-[340px]"
        />
        <div className="flex flex-col items-center gap-4">
          <h2 className="max-w-md font-display text-3xl font-medium leading-[1.05] tracking-tight md:text-4xl">
            <BrandText text={t('landing.download.title', locale)} />
          </h2>
          <p className="max-w-sm text-base leading-relaxed text-muted-foreground">
            {t('landing.preview.caption', locale)}
          </p>
        </div>
        <WaitlistForm locale={locale} source="invite-landing" />
        <p className="max-w-sm text-sm leading-relaxed text-muted-foreground">
          {t('landing.download.founders', locale)}
        </p>
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
