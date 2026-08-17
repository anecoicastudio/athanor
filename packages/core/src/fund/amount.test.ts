import { describe, expect, it } from 'vitest';
import { MIN_CONTRIBUTION_CENTS, parseEuroIntegerToCents, parseEuroToCents } from './amount';

describe('parseEuroToCents', () => {
  it('whole euros → cents', () => {
    expect(parseEuroToCents(1)).toBe(100);
    expect(parseEuroToCents(25)).toBe(2500);
    expect(parseEuroToCents('10')).toBe(1000);
  });
  it('two-decimal amounts (dot and it-IT comma)', () => {
    expect(parseEuroToCents('5.50')).toBe(550);
    expect(parseEuroToCents('5,50')).toBe(550);
    expect(parseEuroToCents('1,99')).toBe(199);
  });
  it('rejects below the €1 minimum', () => {
    expect(parseEuroToCents('0.99')).toBeNull();
    expect(parseEuroToCents(0)).toBeNull();
    expect(parseEuroToCents(-5)).toBeNull();
  });
  it('rejects junk / blank / >2 decimals', () => {
    expect(parseEuroToCents('')).toBeNull();
    expect(parseEuroToCents('abc')).toBeNull();
    expect(parseEuroToCents('1.234')).toBeNull();
    expect(parseEuroToCents(Number.NaN)).toBeNull();
  });
  // Every string case above is already trimmed, so dropping `.trim()` changed nothing. A user
  // typing into a numeric field routinely leaves a trailing space, and untrimmed input fails
  // the regex — the amount would silently read as invalid.
  it('trims surrounding whitespace before parsing', () => {
    expect(parseEuroToCents(' 5 ')).toBe(500);
    expect(parseEuroToCents('\t12,50\n')).toBe(1250);
  });
  it('MIN_CONTRIBUTION_CENTS is €1', () => {
    expect(MIN_CONTRIBUTION_CENTS).toBe(100);
  });
});

/**
 * #387 — the floor is a parameter, defaulted to the fund's €1.
 *
 * The deleted `apps/native/src/lib/price.ts` carried a byte-identical regex purely to express a
 * different floor: a ticket may be free (`events.price_cents >= 0`), a contribution may not.
 * Its cases live on below — one parser, two floors, named at the call site.
 */
describe('parseEuroToCents — the floor is a parameter', () => {
  it('defaults to the fund floor when no floor is named', () => {
    expect(parseEuroToCents('0,99')).toBeNull();
    expect(parseEuroToCents('1,00')).toBe(100);
  });
  it('accepts free and sub-€1 amounts when the floor is zero (ticket prices)', () => {
    expect(parseEuroToCents('0', 0)).toBe(0);
    expect(parseEuroToCents('0,99', 0)).toBe(99);
    expect(parseEuroToCents('0.99', 0)).toBe(99);
  });
  it('honours a floor above €1', () => {
    expect(parseEuroToCents('4,99', 500)).toBeNull();
    expect(parseEuroToCents('5,00', 500)).toBe(500);
  });
  // A lower floor loosens the minimum and nothing else: the shape rules are the parser's own.
  it('rejects malformed input at every floor, never coercing it', () => {
    expect(parseEuroToCents('-5', 0)).toBeNull();
    expect(parseEuroToCents('   ', 0)).toBeNull();
    expect(parseEuroToCents('€10', 0)).toBeNull();
    expect(parseEuroToCents('10 euro', 0)).toBeNull();
    expect(parseEuroToCents('1,005', 0)).toBeNull();
  });
  // `Number` is far more permissive than a money field. Without the regex '1e3' reads as
  // €1000, and '1.000,00' becomes NaN because `replace` rewrites only the first separator.
  it('rejects exponent and thousands-separator notation rather than misreading it', () => {
    expect(parseEuroToCents('1e3', 0)).toBeNull();
    expect(parseEuroToCents('Infinity', 0)).toBeNull();
    expect(parseEuroToCents('1.000,00', 0)).toBeNull();
    expect(parseEuroToCents('1,000,00', 0)).toBeNull();
  });
  // The binary-fraction traps: 2.67 * 100 is 266.999… and 8.16 * 100 is 815.999… in floating
  // point. Rounding is what keeps a cent from silently disappearing at a payment boundary.
  it('does not drop a cent on amounts that float arithmetic rounds down', () => {
    expect(parseEuroToCents('2,67', 0)).toBe(267);
    expect(parseEuroToCents('8,16', 0)).toBe(816);
    expect(parseEuroToCents('19,99', 0)).toBe(1999);
    expect(parseEuroToCents('7,35', 0)).toBe(parseEuroToCents('7.35', 0));
  });
});

/**
 * Whole euros only — a separate parser, not a floor variant of the one above.
 *
 * Candidacy budgets are integer by copy contract: the IT/EN catalogs promise «numeri interi»,
 * so accepting €1,50 would make the hint a lie. Lifted out of `candidacy.tsx`, where it lived
 * as an untested inline const.
 */
describe('parseEuroIntegerToCents', () => {
  it('whole euros → cents', () => {
    expect(parseEuroIntegerToCents('1')).toBe(100);
    expect(parseEuroIntegerToCents('2500')).toBe(250000);
  });
  it('rejects any decimal, in either separator', () => {
    expect(parseEuroIntegerToCents('1,50')).toBeNull();
    expect(parseEuroIntegerToCents('1.50')).toBeNull();
    expect(parseEuroIntegerToCents('1,00')).toBeNull();
  });
  // Strictly positive: a budget of nothing is not a budget. This floor is the field's own and
  // is deliberately NOT MIN_CONTRIBUTION_CENTS — raising the fund's floor must not move it.
  it('rejects zero and negatives', () => {
    expect(parseEuroIntegerToCents('0')).toBeNull();
    expect(parseEuroIntegerToCents('-1')).toBeNull();
  });
  it('rejects junk and blank', () => {
    expect(parseEuroIntegerToCents('')).toBeNull();
    expect(parseEuroIntegerToCents('abc')).toBeNull();
    expect(parseEuroIntegerToCents('1e3')).toBeNull();
  });
  it('trims surrounding whitespace before parsing', () => {
    expect(parseEuroIntegerToCents(' 12 ')).toBe(1200);
  });
});
