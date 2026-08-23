import { describe, expect, it } from 'vitest';
import {
  DATE_PRESETS,
  EVENT_CATEGORIES,
  activeFilterCount,
  dateWindow,
  draftFromParams,
  parseCategory,
  parseDatePreset,
  parseEventFilters,
  serializeEventFilters,
} from './event-filters';

/** A Wednesday, so «questa settimana» has room on both sides of it. */
const WED = new Date(2026, 7, 26, 14, 30, 0, 0); // 26 Aug 2026, local

describe('EVENT_CATEGORIES', () => {
  it('is the schema enum itself, not a second copy that can drift', () => {
    expect(EVENT_CATEGORIES).toEqual([
      'business',
      'networking',
      'spiritualita',
      'formazione',
      'musica',
      'arte',
      'benessere',
      'creativi',
      'evoluzione',
    ]);
  });
});

describe('parseCategory', () => {
  it('accepts every category the schema knows', () => {
    for (const c of EVENT_CATEGORIES) expect(parseCategory(c)).toBe(c);
  });

  it('drops anything outside the enum — a deep link carries whatever the URL says', () => {
    for (const bad of ['sport', '', undefined, 'MUSICA']) {
      expect(parseCategory(bad)).toBeUndefined();
    }
  });
});

describe('parseDatePreset', () => {
  it('accepts every known preset', () => {
    for (const p of DATE_PRESETS) expect(parseDatePreset(p)).toBe(p);
  });

  it('falls back to sempre rather than throwing on an unknown value', () => {
    for (const bad of ['ieri', '', undefined, 'week']) {
      expect(parseDatePreset(bad)).toBe('sempre');
    }
  });
});

describe('dateWindow', () => {
  it('sempre is an open window — no bound at all', () => {
    expect(dateWindow('sempre', WED)).toEqual({});
  });

  it('oggi spans local midnight to local end-of-day', () => {
    const { dateFrom, dateTo } = dateWindow('oggi', WED);
    expect(new Date(dateFrom!).getTime()).toBe(new Date(2026, 7, 26, 0, 0, 0, 0).getTime());
    expect(new Date(dateTo!).getTime()).toBe(new Date(2026, 7, 26, 23, 59, 59, 999).getTime());
  });

  it('settimana ends on the Sunday of the current Monday-start week', () => {
    const { dateTo } = dateWindow('settimana', WED); // Wed 26 Aug 2026 → Sun 30 Aug
    expect(new Date(dateTo!).getTime()).toBe(new Date(2026, 7, 30, 23, 59, 59, 999).getTime());
  });

  it('settimana on a Sunday is that Sunday — the label never overstates the window', () => {
    const sunday = new Date(2026, 7, 30, 9, 0, 0, 0);
    expect(sunday.getDay()).toBe(0);
    const { dateFrom, dateTo } = dateWindow('settimana', sunday);
    expect(new Date(dateFrom!).getDate()).toBe(30);
    expect(new Date(dateTo!).getTime()).toBe(new Date(2026, 7, 30, 23, 59, 59, 999).getTime());
  });

  it('mese ends on the last day of the current month, February included', () => {
    expect(new Date(dateWindow('mese', WED).dateTo!).getTime()).toBe(
      new Date(2026, 7, 31, 23, 59, 59, 999).getTime(),
    );
    const feb = new Date(2028, 1, 3, 12, 0, 0, 0); // 2028 is a leap year
    expect(new Date(dateWindow('mese', feb).dateTo!).getDate()).toBe(29);
  });

  it('never returns a window that ends before it starts', () => {
    for (const p of DATE_PRESETS) {
      const { dateFrom, dateTo } = dateWindow(p, WED);
      if (dateFrom && dateTo) expect(new Date(dateTo) >= new Date(dateFrom)).toBe(true);
    }
  });
});

describe('serializeEventFilters / draftFromParams', () => {
  it('omits every default rather than writing empty strings', () => {
    expect(serializeEventFilters({ category: undefined, city: '', date: 'sempre' })).toEqual({});
    expect(serializeEventFilters({ category: undefined, city: '   ', date: 'sempre' })).toEqual({});
  });

  it('round-trips a full draft', () => {
    const draft = { category: 'musica', city: 'Bologna', date: 'settimana' } as const;
    expect(draftFromParams(serializeEventFilters(draft))).toEqual(draft);
  });

  it('trims the city on the way out, so « Torino » and «Torino» are one filter', () => {
    expect(serializeEventFilters({ city: '  Torino  ', date: 'sempre' }).city).toBe('Torino');
  });

  it('pre-fills the sheet with defaults when the route carries nothing', () => {
    expect(draftFromParams({})).toEqual({ category: undefined, city: '', date: 'sempre' });
  });
});

describe('parseEventFilters', () => {
  it('is undefined when nothing is set — the unfiltered cache entry is preserved', () => {
    expect(parseEventFilters({}, WED)).toBeUndefined();
    expect(parseEventFilters({ city: '   ', date: 'sempre' }, WED)).toBeUndefined();
  });

  it('is undefined for junk params, so a malformed deep link shows the plain calendar', () => {
    expect(parseEventFilters({ category: 'sport', date: 'ieri' }, WED)).toBeUndefined();
  });

  it('resolves the preset against the clock passed in, not a pinned instant', () => {
    const a = parseEventFilters({ date: 'oggi' }, WED);
    const b = parseEventFilters({ date: 'oggi' }, new Date(2026, 8, 4, 8, 0, 0, 0));
    expect(a!.dateTo).not.toBe(b!.dateTo);
    expect(new Date(b!.dateTo!).getDate()).toBe(4);
  });

  it('carries category and city through as the query filters', () => {
    const f = parseEventFilters({ category: 'arte', city: 'Torino' }, WED)!;
    expect(f.category).toBe('arte');
    expect(f.city).toBe('Torino');
    expect(f.dateFrom).toBeUndefined();
  });

  it('drops a city longer than the events.city column rather than sending it', () => {
    expect(parseEventFilters({ city: 'a'.repeat(121) }, WED)).toBeUndefined();
    expect(parseEventFilters({ city: 'a'.repeat(120) }, WED)!.city).toHaveLength(120);
  });
});

describe('activeFilterCount', () => {
  it('counts nothing for an unfiltered route', () => {
    expect(activeFilterCount({})).toBe(0);
    expect(activeFilterCount({ city: '  ', date: 'sempre' })).toBe(0);
  });

  it('counts each set filter once, junk excluded', () => {
    expect(activeFilterCount({ category: 'arte' })).toBe(1);
    expect(activeFilterCount({ category: 'sport' })).toBe(0);
    expect(activeFilterCount({ category: 'arte', city: 'Torino', date: 'mese' })).toBe(3);
  });
});
