import type { Metadata } from 'next';
import { t } from '@auria/i18n';
import { getLocale } from '@/lib/get-locale';
import { LegalDocView } from '@/components/legal-doc';
import { privacy } from '@/lib/legal-content';

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  return { title: `${privacy[locale].title} — ${t('app.name', locale)}` };
}

export default async function PrivacyPage() {
  const locale = await getLocale();
  return <LegalDocView doc={privacy[locale]} locale={locale} />;
}
