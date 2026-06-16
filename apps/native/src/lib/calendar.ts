import { Platform } from 'react-native';
import * as Calendar from 'expo-calendar';

export type CalendarResult = 'added' | 'denied' | 'error';

/** Resolve a writable calendar id (iOS default; first modifiable on Android). */
async function writableCalendarId(): Promise<string | null> {
  if (Platform.OS === 'ios') {
    const def = await Calendar.getDefaultCalendarAsync();
    return def?.id ?? null;
  }
  const calendars = await Calendar.getCalendarsAsync(Calendar.EntityTypes.EVENT);
  const writable = calendars.find((c) => c.allowsModifications);
  return writable?.id ?? null;
}

/**
 * Add an event to the device calendar (permission-gated). Returns 'denied' when the
 * user declines, 'error' on any failure, 'added' on success. Pure device I/O — no DB,
 * no Aura (frontend §6 B12).
 */
export async function addEventToCalendar(opts: {
  title: string;
  startISO: string;
  endISO?: string | null;
  location?: string | null;
  notes?: string | null;
}): Promise<CalendarResult> {
  const { status } = await Calendar.requestCalendarPermissionsAsync();
  if (status !== 'granted') return 'denied';
  try {
    const calendarId = await writableCalendarId();
    if (!calendarId) return 'error';
    const start = new Date(opts.startISO);
    const end = opts.endISO ? new Date(opts.endISO) : new Date(start.getTime() + 60 * 60 * 1000); // default 1h
    await Calendar.createEventAsync(calendarId, {
      title: opts.title,
      startDate: start,
      endDate: end,
      location: opts.location ?? undefined,
      notes: opts.notes ?? undefined,
    });
    return 'added';
  } catch (err) {
    if (__DEV__) console.warn('[calendar] addEventToCalendar', err);
    return 'error';
  }
}
