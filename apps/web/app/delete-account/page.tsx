import type { Metadata } from 'next';
import { t } from '@athanor/i18n';
import { DEFAULT_LOCALE } from '@/lib/default-locale';
import { LegalDocClient } from '@/components/legal-doc-client';
import { deleteAccount } from '@/lib/legal-content';

export const metadata: Metadata = {
  title: `${deleteAccount[DEFAULT_LOCALE].title} — ${t('app.name', DEFAULT_LOCALE)}`,
};

/**
 * The URL in Google Play's Data safety form (#767) — keep the path stable: renaming it breaks a
 * form field nobody re-reads. Instructions and a contact address only; no form, no sign-in.
 */
export default function DeleteAccountPage() {
  return <LegalDocClient doc={deleteAccount} />;
}
