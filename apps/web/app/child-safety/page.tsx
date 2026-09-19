import type { Metadata } from 'next';
import { t } from '@athanor/i18n';
import { DEFAULT_LOCALE } from '@/lib/default-locale';
import { LegalDocClient } from '@/components/legal-doc-client';
import { childSafety } from '@/lib/legal-content';

export const metadata: Metadata = {
  title: `${childSafety[DEFAULT_LOCALE].title} — ${t('app.name', DEFAULT_LOCALE)}`,
};

/**
 * The URL in Google Play's Child Safety Standards declaration (#779) — keep the path stable, as
 * with /delete-account: renaming it breaks a declaration nobody re-reads. Published standards, the
 * in-app report route and a named contact; no form.
 */
export default function ChildSafetyPage() {
  return <LegalDocClient doc={childSafety} />;
}
