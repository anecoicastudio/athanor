import { cookies } from 'next/headers';
import type { Locale } from '@athanor/i18n';

/** Active locale from the `athanor_locale` cookie (IT canonical default). */
export async function getLocale(): Promise<Locale> {
  const value = (await cookies()).get('athanor_locale')?.value;
  return value === 'en' ? 'en' : 'it';
}
