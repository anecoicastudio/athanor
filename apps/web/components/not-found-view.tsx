'use client';

import Link from 'next/link';
import { t } from '@athanor/i18n';
import { useLocale } from '@/components/locale-provider';
import { MandorlaMark } from '@/components/mandorla-mark';

/** Body of the branded 404, client-side so /_not-found can prerender. */
export function NotFoundView() {
  const { locale } = useLocale();
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-8 bg-background px-6 text-center text-foreground">
      <MandorlaMark />
      <h1 className="font-display text-4xl font-medium tracking-tight md:text-5xl">
        {t('notFound.title', locale)}
      </h1>
      <p className="max-w-sm text-muted-foreground">{t('notFound.body', locale)}</p>
      <Link
        href="/"
        className="rounded-full border border-border px-6 py-2 text-sm font-semibold tracking-[0.14em] transition-opacity hover:opacity-80"
      >
        {t('notFound.home', locale)}
      </Link>
    </main>
  );
}
