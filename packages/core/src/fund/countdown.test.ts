import { describe, expect, it } from 'vitest';
import { timeRemaining } from './countdown';

const S = 1000;
const MIN = 60 * S;
const HR = 60 * MIN;
const DAY = 24 * HR;

describe('timeRemaining', () => {
  it('decomposes a future target into d/h/m/s', () => {
    const now = 0;
    const target = 2 * DAY + 3 * HR + 4 * MIN + 5 * S;
    expect(timeRemaining(target, now)).toEqual({
      days: 2,
      hours: 3,
      minutes: 4,
      seconds: 5,
      done: false,
    });
  });

  it('clamps a passed target to all zeros and done', () => {
    expect(timeRemaining(0, 10 * S)).toEqual({
      days: 0,
      hours: 0,
      minutes: 0,
      seconds: 0,
      done: true,
    });
  });

  it('treats the exact target instant as done', () => {
    expect(timeRemaining(1000, 1000)).toEqual({
      days: 0,
      hours: 0,
      minutes: 0,
      seconds: 0,
      done: true,
    });
  });

  it('handles sub-minute remainders', () => {
    expect(timeRemaining(45 * S, 0)).toEqual({
      days: 0,
      hours: 0,
      minutes: 0,
      seconds: 45,
      done: false,
    });
  });

  it('handles large day counts', () => {
    expect(timeRemaining(365 * DAY, 0).days).toBe(365);
  });

  it('treats a NaN target as done (defensive — malformed target_at)', () => {
    expect(timeRemaining(Number.NaN, 0)).toEqual({
      days: 0,
      hours: 0,
      minutes: 0,
      seconds: 0,
      done: true,
    });
  });
});
