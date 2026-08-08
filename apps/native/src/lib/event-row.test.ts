import { describe, expect, it } from 'vitest';
import type { Event } from '@athanor/schemas';
import { toRowData } from './event-row';

const base: Event = {
  id: 'e1',
  host_id: 'h1',
  title: 'Cerchio di apertura',
  category: 'networking',
  starts_at: '2026-06-17T18:00:00.000Z',
  ends_at: null,
  venue: 'Cascina Cuccagna',
  city: 'Milano',
  is_online: false,
  is_kairos_day: false,
  is_athanor_day: false,
  live_started_at: null,
  live_ended_at: null,
} as unknown as Event;

const event = (patch: Partial<Event>): Event => ({ ...base, ...patch });

describe('toRowData — live derivation', () => {
  it('not live before the stream starts', () => {
    expect(toRowData(base, false).live).toBe(false);
  });

  it('live once started and not yet ended', () => {
    const row = toRowData(event({ live_started_at: '2026-06-17T18:00:00.000Z' }), false);
    expect(row.live).toBe(true);
  });

  it('no longer live once ended', () => {
    const row = toRowData(
      event({
        live_started_at: '2026-06-17T18:00:00.000Z',
        live_ended_at: '2026-06-17T19:30:00.000Z',
      }),
      false,
    );
    expect(row.live).toBe(false);
  });

  it('an end without a start is not live', () => {
    const row = toRowData(event({ live_ended_at: '2026-06-17T19:30:00.000Z' }), false);
    expect(row.live).toBe(false);
  });

  it('live is always a boolean, never the raw timestamp', () => {
    const row = toRowData(event({ live_started_at: '2026-06-17T18:00:00.000Z' }), false);
    expect(typeof row.live).toBe('boolean');
  });
});

describe('toRowData — premium lock (Circle entitlement gate)', () => {
  it('an ordinary event is never locked, member or not', () => {
    expect(toRowData(base, false).premiumLocked).toBe(false);
    expect(toRowData(base, true).premiumLocked).toBe(false);
  });

  it('a Kairos-day event locks for a non-member', () => {
    expect(toRowData(event({ is_kairos_day: true }), false).premiumLocked).toBe(true);
  });

  it('an Athanor-day event locks for a non-member', () => {
    expect(toRowData(event({ is_athanor_day: true }), false).premiumLocked).toBe(true);
  });

  it('a member sees premium events unlocked', () => {
    expect(toRowData(event({ is_kairos_day: true }), true).premiumLocked).toBe(false);
    expect(toRowData(event({ is_athanor_day: true }), true).premiumLocked).toBe(false);
  });

  it('both premium flags together still unlock for a member', () => {
    const both = event({ is_kairos_day: true, is_athanor_day: true });
    expect(toRowData(both, false).premiumLocked).toBe(true);
    expect(toRowData(both, true).premiumLocked).toBe(false);
  });
});

describe('toRowData — passthrough fields', () => {
  it('copies identity, place and schedule verbatim', () => {
    const row = toRowData(base, true);
    expect(row).toMatchObject({
      id: 'e1',
      title: 'Cerchio di apertura',
      category: 'networking',
      starts_at: '2026-06-17T18:00:00.000Z',
      venue: 'Cascina Cuccagna',
      city: 'Milano',
      is_online: false,
    });
  });

  it('keeps null venue/city as null rather than coercing', () => {
    const row = toRowData(event({ venue: null, city: null, is_online: true }), true);
    expect(row.venue).toBeNull();
    expect(row.city).toBeNull();
    expect(row.is_online).toBe(true);
  });

  it('leaves the presentation-only fields unset — callers supply them', () => {
    const row = toRowData(base, true);
    expect(row.distanceKm).toBeUndefined();
    expect(row.listeningCount).toBeUndefined();
  });
});
