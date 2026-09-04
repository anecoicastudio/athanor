'use client';

import type { PublicDream } from '@athanor/schemas';
import { PublicDreamView } from '@/components/public-dream-view';
import { useLocale } from '@/components/locale-provider';

/**
 * Client wrapper so a cached /dream/{id} still follows the locale toggle. The page itself
 * renders as IT (crawlers carry no cookie); without this an EN visitor would be stuck with
 * Italian labels permanently, since this page has no LangSwitch of its own to recover with.
 * Same shape and same reason as public-profile-client.tsx.
 */
export function PublicDreamClient({ dream }: { dream: PublicDream }) {
  const { locale } = useLocale();
  return <PublicDreamView dream={dream} locale={locale} />;
}
