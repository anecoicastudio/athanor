import Link from 'next/link';
import { t, type Locale } from '@auria/i18n';
import { AuriaWordmark } from '@/components/auria-wordmark';
import type { LegalDoc } from '@/lib/legal-content';

/** Renders a long-form legal document (privacy / terms) on the dark canvas. */
export function LegalDocView({ doc, locale }: { doc: LegalDoc; locale: Locale }) {
  return (
    <main
      id="main"
      className="mx-auto flex min-h-screen max-w-2xl flex-col gap-10 px-6 py-24 text-foreground"
    >
      <Link href="/" aria-label={t('app.name', locale)} className="self-start">
        <AuriaWordmark className="text-sm" />
      </Link>
      <header className="flex flex-col gap-2 border-b border-border pb-6">
        <h1 className="font-display text-4xl font-medium tracking-tight">{doc.title}</h1>
        <p className="text-sm text-muted-foreground">{doc.updated}</p>
      </header>
      <p className="leading-relaxed text-muted-foreground">{doc.intro}</p>
      {doc.sections.map((section) => (
        <section key={section.heading} className="flex flex-col gap-3">
          <h2 className="font-display text-2xl font-medium tracking-tight">{section.heading}</h2>
          {section.body.map((paragraph) => (
            <p key={paragraph.slice(0, 24)} className="leading-relaxed text-muted-foreground">
              {paragraph}
            </p>
          ))}
        </section>
      ))}
      <p className="rounded-lg border border-border bg-card/40 px-4 py-3 text-xs text-muted-foreground">
        {doc.reviewNote}
      </p>
      <Link
        href="/"
        className="text-sm font-semibold underline underline-offset-4 transition-opacity hover:opacity-80"
      >
        {t('notFound.home', locale)}
      </Link>
    </main>
  );
}
