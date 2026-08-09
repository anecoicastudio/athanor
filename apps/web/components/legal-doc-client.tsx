'use client';

import type { Locale } from '@athanor/i18n';
import { LegalDocView } from '@/components/legal-doc';
import { useLocale } from '@/components/locale-provider';
import { privacy, terms, type LegalDoc } from '@/lib/legal-content';

const DOCS: Record<'privacy' | 'terms', Record<Locale, LegalDoc>> = { privacy, terms };

/**
 * Client wrapper so /privacy and /terms can prerender. The page shell is static IT;
 * this picks the live locale after hydration. Both catalogs ship to the client
 * (~8 KB) — unavoidable once the page is no longer server-rendered per request.
 */
export function LegalDocClient({ doc }: { doc: 'privacy' | 'terms' }) {
  const { locale } = useLocale();
  return <LegalDocView doc={DOCS[doc][locale]} locale={locale} />;
}
