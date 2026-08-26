import { Platform } from 'react-native';
import * as Calendar from 'expo-calendar';
import { toStatus } from '@/lib/media/permission-status';

/**
 * `blocked` is separate from `denied` because only one of them has a way out (#531).
 *
 * The screen used to stay silent on anything but `granted`, on the premise that «the OS
 * permission prompt already informed the user». That holds for the FIRST tap and no other:
 * iOS shows the calendar prompt once per app, and every later request resolves denied
 * immediately with no dialog. Two further ways to land here having seen no prompt at all —
 * iOS 17's «Add Events Only», which `expo-calendar@15.0.8` maps to denied
 * (`CalendarPermissionsRequester.swift:35`, `.writeOnly` → `EXPermissionStatusDenied`), and
 * Expo Go, where the grant belongs to Expo Go and is shared by every project ever run on the
 * phone. In all three the button was a permanent no-op with no feedback.
 */
export type CalendarResult = 'added' | 'denied' | 'blocked' | 'error';

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
 * Add an event to the device calendar (permission-gated). Returns 'added' on success,
 * 'denied' when the member declined and the OS will ask again, 'blocked' when it will not
 * (so the only route left is Settings), 'error' on any failure. Pure device I/O — no DB,
 * no Aura (frontend §6 B12).
 *
 * The denied/blocked split is `toStatus`, the same mapper the media primer uses: `canAskAgain`
 * is the whole difference, and reading it is what the old code skipped. Write-only access
 * arrives here as blocked, which is the honest answer — the grant cannot be widened from
 * inside the app.
 *
 * The PERMISSION REQUEST is inside the try as well, which it was not before. It sat above it,
 * so a throw from `requestCalendarPermissionsAsync` escaped this function entirely: the caller
 * discards the promise (`void onAddToCalendar()`), the root error boundary is a RENDER boundary
 * and never sees a rejected promise, and the member gets no toast, no notice and no Settings
 * route. That is the silent no-op #531 exists to remove, surviving on a narrower path — and it
 * made "'error' on any failure" above a false claim. The rejection is device-only (e.g. an
 * in-flight permission conflict): expo-calendar DOES ship a web stub (`ExpoCalendar.web.ts`),
 * whose request resolves UNDETERMINED with canAskAgain:true and never throws — so the expo-web
 * QA harness lands in the `denied` notice on every tap and cannot reach this catch.
 */
export async function addEventToCalendar(opts: {
  title: string;
  startISO: string;
  endISO?: string | null;
  location?: string | null;
  notes?: string | null;
}): Promise<CalendarResult> {
  try {
    const res = await Calendar.requestCalendarPermissionsAsync();
    const status = toStatus({ granted: res.status === 'granted', canAskAgain: res.canAskAgain });
    if (status !== 'granted') return status === 'blocked' ? 'blocked' : 'denied';
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
