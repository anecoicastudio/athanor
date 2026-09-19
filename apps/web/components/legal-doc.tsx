import Link from 'next/link';
import { t, type Locale } from '@athanor/i18n';
import { AthanorWordmark } from '@/components/athanor-wordmark';
import { LegalNav } from '@/components/legal-nav';
import type { LegalDoc } from '@/lib/legal-content';

/** Renders a long-form legal document (privacy, terms, account deletion, child safety). */
export function LegalDocView({ doc, locale }: { doc: LegalDoc; locale: Locale }) {
  return (
    <main
      id="main"
      className="mx-auto flex min-h-screen max-w-2xl flex-col gap-10 px-6 py-24 text-foreground"
    >
      <Link href="/" aria-label={t('app.name', locale)} className="self-start">
        <AthanorWordmark className="text-sm" />
      </Link>
      <header className="flex flex-col gap-2 border-b border-border pb-6">
        <h1 className="font-display text-4xl font-medium tracking-tight">{doc.title}</h1>
        <p className="text-sm text-muted-foreground">{doc.updated}</p>
      </header>
      <p className="leading-relaxed text-muted-foreground">{doc.intro}</p>
      {doc.sections.map((section) => (
        <section key={section.heading} id={section.id} className="flex scroll-mt-8 flex-col gap-3">
          <h2 className="font-display text-2xl font-medium tracking-tight">{section.heading}</h2>
          {section.body.map((paragraph) => (
            <p key={paragraph.slice(0, 24)} className="leading-relaxed text-muted-foreground">
              {paragraph}
            </p>
          ))}
          {section.links ? (
            <ul className="flex flex-col gap-2">
              {section.links.map((link) => (
                <li key={link.href}>
                  <a
                    href={link.href}
                    // An outside site opens beside this page rather than replacing it; a mailto
                    // hands off to the mail app, where a new tab would only leave a blank one.
                    {...(link.href.startsWith('https://')
                      ? { target: '_blank', rel: 'noopener noreferrer' }
                      : {})}
                    className="break-words font-semibold text-foreground underline underline-offset-4 transition-opacity hover:opacity-80"
                  >
                    {link.label}
                  </a>
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      ))}
      <p className="rounded-lg border border-border bg-card/40 px-4 py-3 text-xs text-muted-foreground">
        {doc.reviewNote}
      </p>
      <LegalNav locale={locale} />
      <Link
        href="/"
        className="text-sm font-semibold underline underline-offset-4 transition-opacity hover:opacity-80"
      >
        {t('notFound.home', locale)}
      </Link>
    </main>
  );
}
