import type { Metadata } from 'next';
import { t } from '@athanor/i18n';
import { DEFAULT_LOCALE } from '@/lib/default-locale';
import { LegalDocClient } from '@/components/legal-doc-client';
import { privacy } from '@/lib/legal-content';

export const metadata: Metadata = {
  title: `${privacy[DEFAULT_LOCALE].title} — ${t('app.name', DEFAULT_LOCALE)}`,
};

export default function PrivacyPage() {
  return <LegalDocClient doc="privacy" />;
}
