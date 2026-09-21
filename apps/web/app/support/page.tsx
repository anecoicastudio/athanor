import type { Metadata } from 'next';
import { t } from '@athanor/i18n';
import { DEFAULT_LOCALE } from '@/lib/default-locale';
import { LegalDocClient } from '@/components/legal-doc-client';
import { support } from '@/lib/legal-content';

export const metadata: Metadata = {
  title: `${support[DEFAULT_LOCALE].title} — ${t('app.name', DEFAULT_LOCALE)}`,
};

/**
 * The Support URL App Store Connect and Play Console require on the app's listing page (#84).
 * Keep the path stable, as with /delete-account and /child-safety: a store listing points at
 * it by URL, not by name.
 */
export default function SupportPage() {
  return <LegalDocClient doc={support} />;
}
