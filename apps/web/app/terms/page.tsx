import type { Metadata } from 'next';
import { t } from '@auria/i18n';
import { getLocale } from '@/lib/get-locale';
import { LegalDocView } from '@/components/legal-doc';
import { terms } from '@/lib/legal-content';

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  return { title: `${terms[locale].title} — ${t('app.name', locale)}` };
}

export default async function TermsPage() {
  const locale = await getLocale();
  return <LegalDocView doc={terms[locale]} locale={locale} />;
}
