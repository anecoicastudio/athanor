import { t } from '@kaira/i18n';

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4">
      <h1 className="text-5xl font-semibold tracking-[0.3em] text-foreground">
        {t('app.name', 'it').toUpperCase()}
      </h1>
      <p className="text-muted-foreground">{t('app.tagline', 'it')}</p>
    </main>
  );
}
