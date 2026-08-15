'use client';

import Link from 'next/link';
import { t } from '@athanor/i18n';
import { useLocale } from '@/components/locale-provider';
import { AthanorWordmark } from '@/components/athanor-wordmark';
import { WaitlistForm } from '@/components/waitlist-form';

/**
 * Body of the `/post/{id}` invitation page (#268). Client-side like InviteView
 * so the page itself carries no per-request work, and deliberately leaner than
 * the invite landing: a doorway, not a hero — no device mockup, no glow.
 */
export function PostInviteView() {
  const { locale } = useLocale();
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
          {t('post.landing.title', locale)}
        </h1>
        <p className="max-w-md text-lg leading-relaxed text-muted-foreground">
          {t('post.landing.body', locale)}
        </p>
      </div>

      <div className="flex flex-col items-center gap-4 pt-6">
        <h2 className="max-w-md font-display text-2xl font-medium leading-snug tracking-tight">
          {t('post.landing.ctaTitle', locale)}
        </h2>
        <p className="max-w-sm text-base leading-relaxed text-muted-foreground">
          {t('post.landing.ctaBody', locale)}
        </p>
        <WaitlistForm locale={locale} source="post-landing" />
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
