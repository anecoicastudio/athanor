import { describe, expect, test } from 'vitest';
import { dayBucket } from './dayBucket';

const now = new Date('2026-06-16T12:00:00');

describe('dayBucket', () => {
  test('same calendar day → today', () => {
    expect(dayBucket('2026-06-16T08:30:00', now).kind).toBe('today');
  });
  test('previous calendar day → yesterday', () => {
    expect(dayBucket('2026-06-15T23:30:00', now).kind).toBe('yesterday');
  });
  test('older → date, carrying the iso through', () => {
    const b = dayBucket('2026-06-10T10:00:00', now);
    expect(b.kind).toBe('date');
    expect(b.iso).toBe('2026-06-10T10:00:00');
  });
});
