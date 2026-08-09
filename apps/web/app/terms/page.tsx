import type { Metadata } from 'next';
import { t } from '@athanor/i18n';
import { DEFAULT_LOCALE } from '@/lib/default-locale';
import { LegalDocClient } from '@/components/legal-doc-client';
import { terms } from '@/lib/legal-content';

export const metadata: Metadata = {
  title: `${terms[DEFAULT_LOCALE].title} — ${t('app.name', DEFAULT_LOCALE)}`,
};

export default function TermsPage() {
  return <LegalDocClient doc="terms" />;
}
