'use client';

import type { PublicEvent } from '@athanor/schemas';
import { PublicEventView } from '@/components/public-event-view';
import { useLocale } from '@/components/locale-provider';

/**
 * Client wrapper so a prerendered /event/{id} still follows the locale toggle — the same
 * reason public-profile-client.tsx exists. The page renders as IT (crawlers carry no
 * cookie); without this an EN visitor would be stuck with Italian labels, since this page
 * has no LangSwitch of its own to recover with.
 */
export function PublicEventClient({ event, isPast }: { event: PublicEvent; isPast: boolean }) {
  const { locale } = useLocale();
  return <PublicEventView event={event} isPast={isPast} locale={locale} />;
}
