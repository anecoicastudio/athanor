import { describe, expect, it } from 'vitest';
import { publicEventSchema } from './public-event';

const row = {
  id: '11111111-1111-4111-8111-111111111111',
  title: 'Sera di incontri',
  category: 'networking',
  is_online: false,
  venue: 'Casa delle Idee',
  city: 'Milano',
  starts_at: '2026-09-01T18:00:00.000Z',
  ends_at: '2026-09-01T21:00:00.000Z',
  price_cents: 1500,
  currency: 'eur',
  is_kairos_day: false,
  is_athanor_day: false,
  organizer_handle: 'sole',
};

describe('publicEventSchema', () => {
  it('parses a physical event row', () => {
    const parsed = publicEventSchema.parse(row);
    expect(parsed.city).toBe('Milano');
    expect(parsed.organizer_handle).toBe('sole');
  });

  it('parses an online event with no venue, no city, no end, and a private organizer', () => {
    const parsed = publicEventSchema.parse({
      ...row,
      is_online: true,
      venue: null,
      city: null,
      ends_at: null,
      organizer_handle: null,
    });
    expect(parsed.is_online).toBe(true);
    expect(parsed.organizer_handle).toBeNull();
  });

  /*
   * The whole point of a separate public read-model: these columns are anon-readable
   * in Postgres and must still never reach a public page. `geo` is approximate location
   * (PRD §4.2), `stream_url` would hand a paid online event away for free, `fee_pct` is
   * server config. .strict() makes a widened select a loud parse error instead of a
   * silent leak the day someone reuses eventSchema's column list here.
   */
  it.each(['geo', 'stream_url', 'fee_pct', 'capacity', 'organizer_id'])(
    'rejects a row carrying %s',
    (column) => {
      expect(publicEventSchema.safeParse({ ...row, [column]: 'x' }).success).toBe(false);
    },
  );

  it('rejects a non-uuid id, an unknown category, and a negative price', () => {
    expect(publicEventSchema.safeParse({ ...row, id: 'not-a-uuid' }).success).toBe(false);
    expect(publicEventSchema.safeParse({ ...row, category: 'bogus' }).success).toBe(false);
    expect(publicEventSchema.safeParse({ ...row, price_cents: -1 }).success).toBe(false);
  });

  it('rejects an organizer handle that is not a valid handle', () => {
    expect(publicEventSchema.safeParse({ ...row, organizer_handle: 'Sole' }).success).toBe(false);
  });
});
