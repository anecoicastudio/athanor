import Link from 'next/link';
import { t } from '@kaira/i18n';
import { createClient } from '@/utils/supabase/server';

export default async function Home() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <main className="flex min-h-screen flex-col bg-blu-notte">
      {/* Header — ☰ menu omitted in M1 (no nav destinations yet) */}
      <header className="flex items-center justify-between border-b border-border px-6 py-4">
        <span aria-hidden className="w-16" />
        <span className="text-sm font-semibold tracking-[0.3em] text-avorio">
          {t('app.name', 'it').toUpperCase()}
        </span>
        <nav className="flex w-16 justify-end">
          {user ? (
            <Link
              href="/profilo"
              className="text-sm text-avorio underline-offset-4 hover:underline"
            >
              {t('tabs.profilo', 'it')}
            </Link>
          ) : (
            <Link href="/login" className="text-sm text-avorio underline-offset-4 hover:underline">
              {t('landing.enter', 'it')}
            </Link>
          )}
        </nav>
      </header>

      {/* Hero */}
      <section className="flex flex-1 flex-col items-center justify-center gap-8 px-6 text-center">
        <h1 className="max-w-xl text-5xl font-semibold text-avorio">{t('app.tagline', 'it')}</h1>
        <Link
          href="/login"
          className="flex h-12 items-center justify-center rounded-full bg-avorio px-8 font-semibold tracking-widest text-blu-notte"
        >
          {t('landing.cta', 'it')}
        </Link>
      </section>
    </main>
  );
}
