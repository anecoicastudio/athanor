import type { PublicEvent } from '@athanor/schemas';
import { SITE_URL } from '@/lib/site';

type JsonLdEvent = {
  '@context': 'https://schema.org';
  '@type': 'Event';
  name: string;
  url: string;
  startDate: string;
  endDate?: string;
  eventStatus: string;
  eventAttendanceMode: string;
  location: Record<string, string>;
  organizer?: { '@type': 'Person'; name: string; url: string };
  offers: { '@type': 'Offer'; price: string; priceCurrency: string; url: string };
};

/**
 * schema.org/Event markup for the public event page — the half of "indexable" that
 * plain HTML cannot express, and what puts an event in Google's event results rather
 * than in a list of blue links.
 *
 * Built from `PublicEvent` only, so it can never describe more than the page shows: a
 * mismatch between markup and visible content is a structured-data violation, and the
 * columns most tempting to add here (`geo`, `stream_url`) are the ones the read-model
 * deliberately drops. An online event therefore points at this page, not at the stream.
 */
export function eventJsonLd(event: PublicEvent, pageUrl: string): JsonLdEvent {
  return {
    '@context': 'https://schema.org',
    '@type': 'Event',
    name: event.title,
    url: pageUrl,
    startDate: event.starts_at,
    // Spread rather than `endDate: x ?? undefined` — an explicit undefined would still
    // read as a declared-but-empty field to anyone inspecting the object.
    ...(event.ends_at ? { endDate: event.ends_at } : {}),
    eventStatus: 'https://schema.org/EventScheduled',
    eventAttendanceMode: event.is_online
      ? 'https://schema.org/OnlineEventAttendanceMode'
      : 'https://schema.org/OfflineEventAttendanceMode',
    location: event.is_online
      ? { '@type': 'VirtualLocation', url: pageUrl }
      : {
          '@type': 'Place',
          name: event.venue ?? event.city ?? '',
          ...(event.city ? { address: event.city } : {}),
        },
    ...(event.organizer_handle
      ? {
          organizer: {
            '@type': 'Person' as const,
            name: `@${event.organizer_handle}`,
            url: `${SITE_URL}/@${event.organizer_handle}`,
          },
        }
      : {}),
    // A free event keeps a zero-priced offer: dropping `offers` reads as "price unknown",
    // which is a weaker and less true statement than "this costs nothing".
    offers: {
      '@type': 'Offer',
      price: (event.price_cents / 100).toFixed(2),
      priceCurrency: event.currency.toUpperCase(),
      url: pageUrl,
    },
  };
}
