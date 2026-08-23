import {
  eventCalendarFiltersSchema,
  eventCategorySchema,
  isEmptyEventCalendarFilters,
  type EventCalendarFilters,
  type EventCategory,
} from '@athanor/schemas';

/**
 * The route-param contract between the events filter sheet and the Live screen (#151),
 * modelled on `search-filters.ts` — the sheet serializes its draft into string params and
 * `dismissTo`s back to /(modal)/live, which re-derives `EventCalendarFilters` from
 * `useLocalSearchParams` and re-runs the calendar query. Both halves live here so the
 * encoding cannot drift across the two screens.
 *
 * The date filter travels as a PRESET NAME, not as the resolved instants. Resolving on
 * read means a sheet left open overnight cannot pin yesterday's «oggi»: the window is
 * recomputed from the current clock every time the params are parsed. `now` is injected
 * for exactly that reason — the resolution is a pure function of (preset, now).
 */

export type DatePreset = 'sempre' | 'oggi' | 'settimana' | 'mese';

export const DATE_PRESETS: DatePreset[] = ['sempre', 'oggi', 'settimana', 'mese'];

export const EVENT_CATEGORIES: EventCategory[] = eventCategorySchema.options;

/** Local-midnight boundaries — the member reads a calendar in their own timezone, not UTC. */
function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
}

function endOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
}

/**
 * Preset → absolute window. Calendar-true, not rolling: «questa settimana» ends on Sunday
 * (Italian weeks start Monday) and «questo mese» on the month's last day, so the label
 * never overstates the window — on a Sunday «questa settimana» really is one day.
 */
export function dateWindow(preset: DatePreset, now: Date): { dateFrom?: string; dateTo?: string } {
  if (preset === 'sempre') return {};
  const from = startOfDay(now);
  if (preset === 'oggi') {
    return { dateFrom: from.toISOString(), dateTo: endOfDay(now).toISOString() };
  }
  if (preset === 'settimana') {
    // getDay(): 0 = Sunday. Monday-start weeks put Sunday 6 days after Monday.
    const daysToSunday = (7 - now.getDay()) % 7;
    const sunday = new Date(now.getFullYear(), now.getMonth(), now.getDate() + daysToSunday);
    return { dateFrom: from.toISOString(), dateTo: endOfDay(sunday).toISOString() };
  }
  // 'mese' — day 0 of the next month is the last day of this one.
  const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  return { dateFrom: from.toISOString(), dateTo: endOfDay(lastDay).toISOString() };
}

/** What the sheet holds while the member is editing. `city` is free text (events.city). */
export type EventFilterDraft = {
  category?: EventCategory;
  city: string;
  date: DatePreset;
};

/** Route params the two screens exchange — every value is a string, or absent. */
export type EventFilterParams = {
  category?: string;
  city?: string;
  date?: string;
};

/**
 * Every param key with an empty value. `serializeEventFilters` omits defaults — that is what
 * keeps an unfiltered calendar carrying no params — but a param UPDATE merges, so clearing a
 * filter has to write the key as empty rather than leave it out, or the previous value stands
 * and «Azzera» appears to do nothing. Spread this first, then the serialized draft over it.
 */
export const EMPTY_EVENT_FILTER_PARAMS: Required<EventFilterParams> = {
  category: '',
  city: '',
  date: '',
};

/** Narrow a raw param to the event category enum; anything else is ignored (defence-in-depth). */
export function parseCategory(raw?: string): EventCategory | undefined {
  const parsed = eventCategorySchema.safeParse(raw);
  return parsed.success ? parsed.data : undefined;
}

/** Narrow a raw param to a known preset; an unknown one means «sempre», never a crash. */
export function parseDatePreset(raw?: string): DatePreset {
  return raw !== undefined && (DATE_PRESETS as string[]).includes(raw)
    ? (raw as DatePreset)
    : 'sempre';
}

/**
 * Params → draft, for pre-filling the sheet from the route. Deep links carry whatever the
 * URL says, so every field is narrowed rather than trusted.
 */
export function draftFromParams(params: EventFilterParams): EventFilterDraft {
  return {
    category: parseCategory(params.category),
    city: params.city ?? '',
    date: parseDatePreset(params.date),
  };
}

/**
 * Draft → route params. Absent/empty values are omitted entirely rather than written as
 * empty strings, so an unfiltered calendar carries no params at all.
 */
export function serializeEventFilters(draft: EventFilterDraft): EventFilterParams {
  const params: EventFilterParams = {};
  if (draft.category) params.category = draft.category;
  const city = draft.city.trim();
  if (city) params.city = city;
  if (draft.date !== 'sempre') params.date = draft.date;
  return params;
}

/**
 * Params → the filters the query takes. Returns `undefined` when nothing is set, which is
 * what `eventKeys.calendar()` reads as unfiltered — so an unfiltered Calendario shares its
 * cache entry with Mappa and with the pre-#151 key exactly as before.
 *
 * The result goes through `eventCalendarFiltersSchema` rather than being cast: a param is
 * attacker-controlled, and rules/api.md forbids a cast at a query boundary. A city longer
 * than the column allows is dropped rather than sent.
 */
export function parseEventFilters(
  params: EventFilterParams,
  now: Date = new Date(),
): EventCalendarFilters | undefined {
  const draft = draftFromParams(params);
  const candidate = {
    category: draft.category,
    city: draft.city.trim() || undefined,
    ...dateWindow(draft.date, now),
  };
  const parsed = eventCalendarFiltersSchema.safeParse(candidate);
  if (!parsed.success) return undefined;
  return isEmptyEventCalendarFilters(parsed.data) ? undefined : parsed.data;
}

/** How many filters the member has set — drives the «filtri attivi» count on the trigger. */
export function activeFilterCount(params: EventFilterParams): number {
  const draft = draftFromParams(params);
  let n = 0;
  if (draft.category) n += 1;
  if (draft.city.trim()) n += 1;
  if (draft.date !== 'sempre') n += 1;
  return n;
}
