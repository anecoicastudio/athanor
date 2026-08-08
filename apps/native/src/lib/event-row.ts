import type { Event, EventCategory } from '@athanor/schemas';

export type EventRowData = {
  id: string;
  title: string;
  category: EventCategory;
  starts_at: string;
  venue: string | null;
  city: string | null;
  is_online?: boolean;
  is_kairos_day?: boolean;
  is_athanor_day?: boolean;
  live?: boolean;
  /** Premium (Kairos/Athanor-Day) event AND the viewer is not a Circle member → show the lock marker. */
  premiumLocked?: boolean;
  /** Pre-formatted "x km" sub-fragment (Vicino/Mappa); omit elsewhere. */
  distanceKm?: string | null;
  /** Realtime live-listener count; when present on a live row → «In diretta ora · {n} in ascolto». */
  listeningCount?: number | null;
};

/** Map a full `Event` to the row shape, deriving live + premium-lock state. */
export function toRowData(e: Event, premiumEnabled: boolean): EventRowData {
  const live = !!e.live_started_at && !e.live_ended_at;
  const isPremium = e.is_kairos_day || e.is_athanor_day;
  return {
    id: e.id,
    title: e.title,
    category: e.category,
    starts_at: e.starts_at,
    venue: e.venue,
    city: e.city,
    is_online: e.is_online,
    is_kairos_day: e.is_kairos_day,
    is_athanor_day: e.is_athanor_day,
    premiumLocked: isPremium && !premiumEnabled,
    live,
  };
}
