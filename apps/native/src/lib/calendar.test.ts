import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The permission mapping is the whole point of this file (#531). Before it, anything but
 * `granted` collapsed to one `'denied'` and the screen stayed silent on all of it — so a
 * member whose grant could never be re-prompted (iOS «Add Events Only», or an Expo Go grant
 * belonging to a different project) tapped «Calendario» forever with nothing happening.
 *
 * `react-native` is mocked because this suite runs in `environment: 'node'` and RN ships
 * untranspiled Flow; `Platform.OS` is the only thing this module reads from it.
 */
const cal = vi.hoisted(() => ({
  perm: { status: 'granted', canAskAgain: true } as { status: string; canAskAgain: boolean },
  defaultCalendar: { id: 'cal-1' } as { id: string } | null,
  created: [] as unknown[],
  throwOnCreate: false,
}));

vi.mock('react-native', () => ({ Platform: { OS: 'ios' } }));

vi.mock('expo-calendar', () => ({
  EntityTypes: { EVENT: 'event' },
  requestCalendarPermissionsAsync: async () => cal.perm,
  getDefaultCalendarAsync: async () => cal.defaultCalendar,
  getCalendarsAsync: async () => [{ id: 'cal-android', allowsModifications: true }],
  createEventAsync: async (id: string, details: unknown) => {
    if (cal.throwOnCreate) throw new Error('calendar write failed');
    cal.created.push({ id, details });
    return 'event-1';
  },
}));

import { addEventToCalendar } from './calendar';

const EVENT = { title: 'Cerchio', startISO: '2026-09-01T18:00:00.000Z' };

beforeEach(() => {
  cal.perm = { status: 'granted', canAskAgain: true };
  cal.defaultCalendar = { id: 'cal-1' };
  cal.created = [];
  cal.throwOnCreate = false;
});

describe('addEventToCalendar maps every permission outcome', () => {
  it('granted → added, and the event is written', async () => {
    await expect(addEventToCalendar(EVENT)).resolves.toBe('added');
    expect(cal.created).toHaveLength(1);
  });

  it('declined but re-promptable → denied', async () => {
    cal.perm = { status: 'denied', canAskAgain: true };
    await expect(addEventToCalendar(EVENT)).resolves.toBe('denied');
    expect(cal.created, 'nothing is written without a grant').toHaveLength(0);
  });

  // One case, not two. iOS write-only is not a distinct INPUT here: expo-calendar@15.0.8 maps
  // `.writeOnly` to EXPermissionStatusDenied (CalendarPermissionsRequester.swift:35) and the OS
  // will not prompt again, so it arrives as exactly this pair. That is the reproduction in
  // #531 — a grant that exists, cannot be widened from inside the app, and was
  // indistinguishable from a fresh refusal.
  it('declined and not re-promptable → blocked, the state that needs Settings', async () => {
    cal.perm = { status: 'denied', canAskAgain: false };
    await expect(addEventToCalendar(EVENT)).resolves.toBe('blocked');
    expect(cal.created, 'nothing is written without a grant').toHaveLength(0);
  });

  it('granted but no writable calendar → error', async () => {
    cal.defaultCalendar = null;
    await expect(addEventToCalendar(EVENT)).resolves.toBe('error');
  });

  it('a throwing write → error, never a false confirmation', async () => {
    cal.throwOnCreate = true;
    await expect(addEventToCalendar(EVENT)).resolves.toBe('error');
  });

  it('defaults the end to one hour after the start', async () => {
    await addEventToCalendar(EVENT);
    const { details } = cal.created[0] as { details: { startDate: Date; endDate: Date } };
    expect(details.endDate.getTime() - details.startDate.getTime()).toBe(60 * 60 * 1000);
  });
});
