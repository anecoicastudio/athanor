'use client';

import type { Locale } from '@athanor/i18n';
import { LegalDocView } from '@/components/legal-doc';
import { useLocale } from '@/components/locale-provider';
import type { LegalDoc } from '@/lib/legal-content';

/**
 * Client wrapper so /privacy, /terms, /delete-account, /child-safety and /support can prerender. The page
 * shell is static IT; this picks the live locale after hydration. The page hands over its own
 * document, both locales, so each page ships only that one — unavoidable once the page is no
 * longer server-rendered per request, and a new document (#767, #779) must not grow the others.
 */
export function LegalDocClient({ doc }: { doc: Record<Locale, LegalDoc> }) {
  const { locale } = useLocale();
  return <LegalDocView doc={doc[locale]} locale={locale} />;
}
