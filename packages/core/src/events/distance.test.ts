import { describe, expect, it } from 'vitest';
import { NEARBY_RADIUS_KM, metersToKm } from './distance';

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

describe('NEARBY_RADIUS_KM', () => {
  // The privacy policy promises «50 chilometri» (apps/web/lib/legal-content.ts, #783): the
  // Vicino query and the policy prose both read this one constant, so this pins the promise.
  it('is the 50 km radius the privacy policy states', () => {
    expect(NEARBY_RADIUS_KM).toBe(50);
  });
});
