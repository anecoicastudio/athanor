import { cookies } from 'next/headers';
import type { Locale } from '@athanor/i18n';

/** Active locale from the `athanor_locale` cookie (IT canonical default).
 *
 * /admin only. Public pages are prerendered and must not read cookies — awaiting
 * cookies() opts a route into dynamic rendering, which is what kept the whole site
 * server-rendered. Use lib/default-locale.ts there instead. Admin pages are
 * force-dynamic regardless. */
export async function getLocale(): Promise<Locale> {
  const value = (await cookies()).get('athanor_locale')?.value;
  return value === 'en' ? 'en' : 'it';
}
