import { describe, expect, it } from 'vitest';
import { cardInitial, quoteFontSize } from './og-card';

describe('quoteFontSize', () => {
  it('gives a short dream display-grade type', () => {
    expect(quoteFontSize(1)).toBe(64);
    expect(quoteFontSize(90)).toBe(64);
  });

  it('steps down at each boundary', () => {
    expect(quoteFontSize(91)).toBe(56);
    expect(quoteFontSize(160)).toBe(56);
    expect(quoteFontSize(161)).toBe(46);
    expect(quoteFontSize(260)).toBe(46);
    expect(quoteFontSize(261)).toBe(40);
    expect(quoteFontSize(380)).toBe(40);
  });

  it('keeps the 500-char schema maximum at the floor size', () => {
    expect(quoteFontSize(381)).toBe(34);
    expect(quoteFontSize(500)).toBe(34);
  });
});

describe('cardInitial', () => {
  it('prefers the display name', () => {
    expect(cardInitial('Lucia Ferri', 'lucia')).toBe('L');
  });

  it('falls back to the handle when the name is null or blank', () => {
    expect(cardInitial(null, 'lucia')).toBe('L');
    expect(cardInitial('   ', 'marco')).toBe('M');
  });

  it('uppercases and survives astral-plane characters', () => {
    expect(cardInitial('élodie', 'e')).toBe('É');
    expect(cardInitial('𝕃ucia', 'lucia')).toBe('𝕃');
  });

  it('returns empty for the impossible empty-handle case rather than throwing', () => {
    expect(cardInitial(null, '')).toBe('');
  });
});
