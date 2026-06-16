import { describe, expect, it } from 'vitest';
import { formatPrice } from './price';

// Normalize the non-breaking space (U+00A0) ICU inserts around the currency symbol.
const norm = (s: string) => s.replace(/ /g, ' ');

describe('formatPrice', () => {
  it('formats euro cents in Italian (symbol trailing)', () => {
    expect(norm(formatPrice(1500, 'eur', 'it'))).toBe('15,00 €');
  });

  it('formats euro cents in English (symbol leading)', () => {
    expect(norm(formatPrice(1500, 'eur', 'en'))).toBe('€15.00');
  });

  it('formats zero', () => {
    expect(norm(formatPrice(0, 'eur', 'en'))).toBe('€0.00');
  });

  it('uppercases the ISO currency code for Intl', () => {
    // 'eur' (our DB stores lowercase) must not throw — Intl needs 'EUR'.
    expect(() => formatPrice(999, 'eur', 'it')).not.toThrow();
  });
});
