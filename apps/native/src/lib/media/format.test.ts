import { describe, expect, it } from 'vitest';
import { aspectRatio, formatDuration } from './format';

describe('formatDuration', () => {
  it('renders M:SS with a zero-padded seconds field', () => {
    expect(formatDuration(165)).toBe('2:45');
    expect(formatDuration(65)).toBe('1:05');
    expect(formatDuration(9)).toBe('0:09');
  });

  it('zero is a real duration, not an empty label', () => {
    expect(formatDuration(0)).toBe('0:00');
  });

  it('exact minutes keep the :00', () => {
    expect(formatDuration(60)).toBe('1:00');
    expect(formatDuration(600)).toBe('10:00');
  });

  it('minutes are never wrapped into hours', () => {
    expect(formatDuration(3600)).toBe('60:00');
    expect(formatDuration(3661)).toBe('61:01');
  });

  it('fractional seconds are floored, not rounded', () => {
    expect(formatDuration(65.9)).toBe('1:05');
    expect(formatDuration(0.9)).toBe('0:00');
  });

  it('null renders nothing — the caller hides the chip', () => {
    expect(formatDuration(null)).toBe('');
  });

  it('a negative duration renders nothing rather than "-1:-1"', () => {
    expect(formatDuration(-1)).toBe('');
    expect(formatDuration(-120)).toBe('');
  });
});

describe('aspectRatio', () => {
  it('divides width by height when both are known', () => {
    expect(aspectRatio({ width: 1600, height: 900 })).toBeCloseTo(16 / 9);
    expect(aspectRatio({ width: 1000, height: 1000 })).toBe(1);
  });

  it('falls back to 4:5 portrait when dimensions are missing', () => {
    expect(aspectRatio({ width: null, height: null })).toBe(4 / 5);
    expect(aspectRatio({ width: 1600, height: null })).toBe(4 / 5);
    expect(aspectRatio({ width: null, height: 900 })).toBe(4 / 5);
  });

  it('a zero dimension falls back rather than dividing by zero', () => {
    expect(aspectRatio({ width: 1600, height: 0 })).toBe(4 / 5);
    expect(aspectRatio({ width: 0, height: 900 })).toBe(4 / 5);
  });

  it('never returns a non-finite ratio', () => {
    const cases = [
      { width: 1600, height: 900 },
      { width: 0, height: 0 },
      { width: null, height: null },
      { width: 1, height: 10_000 },
    ];
    for (const c of cases) {
      const r = aspectRatio(c);
      expect(Number.isFinite(r)).toBe(true);
      expect(r).toBeGreaterThan(0);
    }
  });
});
