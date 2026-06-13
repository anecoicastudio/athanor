import Link from 'next/link';
import { t } from '@auria/i18n';
import { getLocale } from '@/lib/get-locale';
import { MandorlaMark } from '@/components/mandorla-mark';

/** Branded 404 — the mandorla, a calm line, and the way home. */
export default async function NotFound() {
  const L = await getLocale();
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-8 bg-background px-6 text-center text-foreground">
      <MandorlaMark />
      <h1 className="font-display text-4xl font-medium tracking-tight md:text-5xl">
        {t('notFound.title', L)}
      </h1>
      <p className="max-w-sm text-muted-foreground">{t('notFound.body', L)}</p>
      <Link
        href="/"
        className="rounded-full border border-border px-6 py-2 text-sm font-semibold tracking-[0.14em] transition-opacity hover:opacity-80"
      >
        {t('notFound.home', L)}
      </Link>
    </main>
  );
}
