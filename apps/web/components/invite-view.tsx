'use client';

import Link from 'next/link';
import { t } from '@athanor/i18n';
import { useLocale } from '@/components/locale-provider';
import { AthanorWordmark, BrandText } from '@/components/athanor-wordmark';
import { DeviceMockup } from '@/components/device-mockup';
import { WaitlistForm } from '@/components/waitlist-form';

/** Body of the personal invite landing, client-side so the page carries no per-request work. */
export function InviteView({ code }: { code: string | null }) {
  const { locale } = useLocale();
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
