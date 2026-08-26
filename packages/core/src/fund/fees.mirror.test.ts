import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { MIN_CONTRIBUTION_CENTS } from './amount';
import { STRIPE_FEE_BPS, STRIPE_FEE_FIXED_CENTS, feeCoverage } from './fees';

/**
 * `fees.ts` says the edge function `create-contribution-session` carries a Deno-native copy of
 * both constants AND of the gross-up formula, and that the copy is the AUTHORITY — the server
 * recomputes, the client's figure is display only. Both sides said "change one, change both"
 * and both sides enforced it by pinning the same literals in their OWN suite
 * (`fees.test.ts:23-24`, `logic.test.ts:244-245`), which is two independent claims about one
 * number and not a comparison of anything. Nothing read across the boundary.
 *
 * The failure that shape allows is the worst-lit one in the product: the disclosure screen
 * quotes a payer one figure, the server charges another, and the difference is real money
 * against a fund whose whole premise is that the ledger is honest. No test goes red — each
 * suite still agrees with itself.
 *
 * `MIN_CONTRIBUTION_CENTS` is a fourth copy of the same shape and is guarded here too: it is
 * DECLARED in `@athanor/schemas` (re-exported by `./amount`), duplicated at `logic.ts:53`, and
 * the DB CHECK in `20260618153032_m7_contributions.sql` is the third copy — pinned by pgTAP
 * `0118_fund_fee_coverage`, which this file cannot reach and does not try to.
 *
 * ## Compared as text, because the mirror cannot be imported
 *
 * `logic.ts` is Deno source — `npm:` specifiers, its own `deno.json`, outside the pnpm
 * workspace — so vitest cannot load it. `version.mirror.test.ts` closes the same class of claim
 * for the force-update gate; `notification-templates.mirror.test.ts` was the first to read a
 * Deno file as text rather than leave the pair to review. The Deno suite already cross-reads
 * `packages/schemas/src/fund.ts` (`logic.test.ts:159`), so the machinery is precedent on both
 * sides of the boundary; what neither side had was a read of the FEE constants.
 *
 * ## One deliberate divergence, scoped rather than ignored
 *
 * The two `feeCoverage` bodies are NOT identical and must not be asserted so: the core copy
 * throws `RangeError` below the €1 floor, the Deno copy deliberately does not validate
 * (`logic.ts:90`: "Callers must have passed isValidContributionAmount first"). So the
 * comparison is scoped to the arithmetic — the three statements that decide what the card is
 * charged — and the safety that makes the Deno omission sound (validate, THEN gross up) is
 * asserted separately, at its call site.
 */
/**
 * Found by walking UP, not by counting `../`: Stryker runs this package's suite from a sandbox
 * copy two levels deeper than the package sits in the repo, where a fixed relative path
 * resolves to `packages/core/supabase/...` and kills the dry run. (`affinity.mirror.test.ts`
 * and `version.mirror.test.ts` carry the same note.)
 */
function above(...segments: string[]): string {
  let dir = fileURLToPath(new URL('.', import.meta.url).href);
  for (;;) {
    const candidate = join(dir, ...segments);
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) throw new Error(`no ${segments.join('/')} above this test`);
    dir = parent;
  }
}

const MIRROR_SOURCE = readFileSync(
  above('supabase', 'functions', 'create-contribution-session', 'logic.ts'),
  'utf8',
);
const SELF_SOURCE = readFileSync(above('packages', 'core', 'src', 'fund', 'fees.ts'), 'utf8');

/** Drop comments, collapse whitespace: compare the code, not the prose or the formatting. */
function code(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

/** A bare `export const NAME = <integer>;`, as an integer. */
function constant(source: string, name: string, where: string): number {
  const found = source.match(new RegExp(`^export const ${name} = (\\d[\\d_]*);`, 'm'))?.[1];
  if (found === undefined) throw new Error(`${where} declares no integer const ${name}`);
  return Number(found.replaceAll('_', ''));
}

/**
 * The gross-up arithmetic of `feeCoverage`: everything from the first statement that touches
 * the constants through the end of the function. Deliberately NOT the whole body — see the
 * divergence note above.
 */
function grossUp(source: string, where: string): string {
  const start = source.search(/^(export )?function feeCoverage\(/m);
  if (start < 0) throw new Error(`${where} declares no function feeCoverage`);
  const rest = source.slice(start);
  const end = rest.indexOf('\n}');
  if (end < 0) throw new Error(`${where}'s feeCoverage has no column-0 closing brace`);
  const body = code(rest.slice(0, end + 2));
  const arithmetic = body.indexOf('const numerator');
  if (arithmetic < 0) throw new Error(`${where}'s feeCoverage no longer opens with a numerator`);
  return body.slice(arithmetic);
}

describe('the Stripe fee pair mirrors create-contribution-session/logic.ts', () => {
  // Every comparison below extracts both halves by regex from two files. A silently-empty
  // extraction would make `'' === ''` pass and leave the guard decorative, so the extraction is
  // pinned to content before anything is compared against anything.
  it('extracts a non-trivial gross-up from both sides', () => {
    for (const [where, source] of [
      ['packages/core/src/fund/fees.ts', SELF_SOURCE],
      ['supabase/functions/create-contribution-session/logic.ts', MIRROR_SOURCE],
    ] as const) {
      const arithmetic = grossUp(source, where);
      // Rounding UP is the property that keeps coverage a cost and never an undisclosed
      // margin, so it is what a broken extraction would stop guarding.
      expect(arithmetic, where).toContain('% denominator > 0 ? 1 : 0');
      expect(arithmetic.length, where).toBeGreaterThan(150);
    }
  });

  it('STRIPE_FEE_BPS is the same number on both sides', () => {
    expect(constant(MIRROR_SOURCE, 'STRIPE_FEE_BPS', 'the Deno mirror')).toBe(STRIPE_FEE_BPS);
  });

  it('STRIPE_FEE_FIXED_CENTS is the same number on both sides', () => {
    expect(constant(MIRROR_SOURCE, 'STRIPE_FEE_FIXED_CENTS', 'the Deno mirror')).toBe(
      STRIPE_FEE_FIXED_CENTS,
    );
  });

  it('MIN_CONTRIBUTION_CENTS is the same number on both sides', () => {
    // Declared in @athanor/schemas, re-exported by ./amount, duplicated in the edge function.
    // The DB CHECK is a third copy and belongs to pgTAP 0118, not to this file.
    expect(constant(MIRROR_SOURCE, 'MIN_CONTRIBUTION_CENTS', 'the Deno mirror')).toBe(
      MIN_CONTRIBUTION_CENTS,
    );
  });

  it('the gross-up arithmetic is the same code on both sides', () => {
    expect(grossUp(MIRROR_SOURCE, 'the Deno mirror')).toBe(grossUp(SELF_SOURCE, 'packages/core'));
  });

  it('the mirror validates the gift BEFORE grossing it up', () => {
    // What makes the Deno copy's missing RangeError sound. The floor is on the GIFT: coverage
    // may not lift a sub-€1 contribution over the line, so the order is the invariant, not the
    // presence of a guard inside feeCoverage.
    const validates = MIRROR_SOURCE.indexOf('if (!isValidContributionAmount(amountCents))');
    const grossesUp = MIRROR_SOURCE.indexOf('feeCoverage(amountCents)');
    expect(validates, 'the mirror no longer gates on isValidContributionAmount').toBeGreaterThan(
      -1,
    );
    expect(grossesUp, 'the mirror no longer calls feeCoverage').toBeGreaterThan(-1);
    expect(validates).toBeLessThan(grossesUp);
  });

  it('both sides still name each other, so the pair stays reviewable', () => {
    expect(MIRROR_SOURCE).toContain('packages/core/src/fund/fees.ts');
    expect(SELF_SOURCE).toContain('create-contribution-session');
  });

  // Cheap, and it is what the imported copy is FOR: the text comparison proves the two agree,
  // this proves what they agree ON still nets the fund whole.
  it('the imported copy still nets the fund whole at the floor', () => {
    const { giftCents, coverageCents, chargedCents } = feeCoverage(MIN_CONTRIBUTION_CENTS);
    expect(giftCents + coverageCents).toBe(chargedCents);
    const stripeTakes =
      Math.floor((chargedCents * STRIPE_FEE_BPS) / 10_000) + STRIPE_FEE_FIXED_CENTS;
    expect(chargedCents - stripeTakes).toBeGreaterThanOrEqual(giftCents);
  });
});
