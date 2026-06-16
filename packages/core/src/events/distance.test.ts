import { describe, expect, it } from 'vitest';
import { metersToKm } from './distance';

describe('metersToKm', () => {
  it('rounds to one decimal by default', () => {
    expect(metersToKm(2100)).toBe('2.1');
  });
  it('drops the decimal when whole', () => {
    expect(metersToKm(5000)).toBe('5');
  });
  it('shows sub-kilometre distances with one decimal', () => {
    expect(metersToKm(380)).toBe('0.4');
  });
  it('formats zero as 0', () => {
    expect(metersToKm(0)).toBe('0');
  });
});
