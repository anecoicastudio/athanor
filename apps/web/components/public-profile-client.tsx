'use client';

import type { PublicProfile } from '@athanor/schemas';
import { PublicProfileView } from '@/components/public-profile-view';
import { useLocale } from '@/components/locale-provider';

/**
 * Client wrapper so a prerendered /@handle still follows the locale toggle. The
 * page itself renders as IT (crawlers carry no cookie); without this an EN visitor
 * would be stuck with Italian labels permanently, since this page has no LangSwitch
 * of its own to recover with.
 */
export function PublicProfileClient({ profile }: { profile: PublicProfile }) {
  const { locale } = useLocale();
  return <PublicProfileView profile={profile} locale={locale} />;
}
