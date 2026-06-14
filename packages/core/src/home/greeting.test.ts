import { describe, expect, it } from 'vitest';
import { greetingFor } from './greeting';

describe('greetingFor', () => {
  it('is morning from 05:00 through 11:59', () => {
    expect(greetingFor(5)).toBe('morning');
    expect(greetingFor(8)).toBe('morning');
    expect(greetingFor(11)).toBe('morning');
  });
  it('is afternoon from 12:00 through 17:59', () => {
    expect(greetingFor(12)).toBe('afternoon');
    expect(greetingFor(15)).toBe('afternoon');
    expect(greetingFor(17)).toBe('afternoon');
  });
  it('is evening from 18:00 through 04:59 (wraps past midnight)', () => {
    expect(greetingFor(18)).toBe('evening');
    expect(greetingFor(23)).toBe('evening');
    expect(greetingFor(0)).toBe('evening');
    expect(greetingFor(4)).toBe('evening');
  });
  it('floors fractional hours to the containing hour', () => {
    expect(greetingFor(11.9)).toBe('morning');
    expect(greetingFor(17.5)).toBe('afternoon');
  });
  it('falls back to morning for non-finite / out-of-range input (defensive)', () => {
    expect(greetingFor(Number.NaN)).toBe('morning');
    expect(greetingFor(-3)).toBe('morning');
    expect(greetingFor(99)).toBe('morning');
  });
});
