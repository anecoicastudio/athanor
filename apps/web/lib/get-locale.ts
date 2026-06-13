import { cookies } from 'next/headers';
import type { Locale } from '@auria/i18n';

/** Active locale from the `auria_locale` cookie (IT canonical default). */
export async function getLocale(): Promise<Locale> {
  const value = (await cookies()).get('auria_locale')?.value;
  return value === 'en' ? 'en' : 'it';
}
