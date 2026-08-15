import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DISCLOSURE_BLOCKS } from './fund-disclosure';

/**
 * FUND-18 / #235 — the blocking pre-payment disclosure, asserted two ways.
 *
 * 1. STRUCTURE: the six blocks and sixteen facts, each key BY NAME (never `count === 16`
 *    — a count passes on sixteen wrong keys and fails on an honest merge). The catalog
 *    half of the same contract lives in packages/i18n/src/i18n.test.ts.
 *
 * 2. NAVIGATION: payment cannot be reached without the screen. This app has no component
 *    harness (vitest runs `environment: 'node'` over `*.test.ts` — nothing that renders
 *    is collectable), so the proof is structural, the source-audit idiom: the ONLY file
 *    that imports or calls `createContributionSession` is the disclosure screen, and
 *    annual.tsx can only push to it. A second call site — the actual bypass — fails here.
 *
 * `.href` (a string), not the URL object — same idiom as source-audit.test.ts.
 */
const SRC = fileURLToPath(new URL('..', import.meta.url).href);
const NATIVE = fileURLToPath(new URL('../..', import.meta.url).href);
const rel = (p: string) => `apps/native/${p.slice(NATIVE.length)}`;

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = `${dir}${name}`;
    if (statSync(p).isDirectory()) walk(`${p}/`, out);
    else if (p.endsWith('.ts') || p.endsWith('.tsx')) out.push(p);
  }
  return out;
}

const SELF = fileURLToPath(new URL(import.meta.url).href);
const FILES = walk(SRC).filter((p) => p !== SELF && !/\.test\.tsx?$/.test(p));
const read = (p: string) => readFileSync(p, 'utf8');

const DISCLOSURE_SCREEN = 'app/(modal)/fund-disclosure.tsx';
const ANNUAL_SCREEN = 'app/(modal)/annual.tsx';
const screenPath = (s: string) => `${SRC}${s}`;

describe('the sixteen facts in six blocks (FUND-SPEC §3)', () => {
  it('matches the spec block-for-block, each fact key by name', () => {
    // Deep equality on NAMES: block membership is the spec's. Moving a fact between
    // blocks, renaming one, or padding with a seventeenth all fail loudly here.
    expect(DISCLOSURE_BLOCKS.map((b) => ({ title: b.title, facts: [...b.facts] }))).toEqual([
      {
        title: 'fund.disclose.where.title',
        facts: [
          'fund.disclose.where.pool',
          'fund.disclose.where.anyAmount',
          'fund.disclose.where.fees',
        ],
      },
      {
        title: 'fund.disclose.notPurchase.title',
        facts: [
          'fund.disclose.notPurchase.noShare',
          'fund.disclose.notPurchase.noAdvantage',
          'fund.disclose.notPurchase.voteDecides',
        ],
      },
      {
        title: 'fund.disclose.noReturn.title',
        facts: [
          'fund.disclose.noReturn.othersDream',
          'fund.disclose.noReturn.notReturned',
          'fund.disclose.noReturn.nextDream',
        ],
      },
      {
        title: 'fund.disclose.ifFails.title',
        facts: [
          'fund.disclose.ifFails.belowFloor',
          'fund.disclose.ifFails.belowQuorum',
          'fund.disclose.ifFails.winnerDeclines',
          'fund.disclose.ifFails.shortBudget',
        ],
      },
      {
        title: 'fund.disclose.retains.title',
        facts: ['fund.disclose.retains.percent', 'fund.disclose.retains.equity'],
      },
      {
        title: 'fund.disclose.compliance.title',
        facts: ['fund.disclose.compliance.law'],
      },
    ]);
  });
});

describe('payment is unreachable without the disclosure screen (#235)', () => {
  it('createContributionSession is imported from @athanor/api only by the disclosure screen', () => {
    // Matches the import clause, not prose: a comment mentioning the symbol never has
    // `from '@athanor/api'` behind a brace group containing it.
    const importers = FILES.filter((p) =>
      /import\s*\{[^}]*\bcreateContributionSession\b[^}]*\}\s*from\s*'@athanor\/api'/.test(read(p)),
    ).map((p) => rel(p).replace('apps/native/src/', ''));
    expect(importers).toEqual([DISCLOSURE_SCREEN]);
  });

  it('createContributionSession is CALLED only in the disclosure screen', () => {
    // The paren keeps prose mentions out; keep any future comment paren-free.
    const callers = FILES.filter((p) => read(p).includes('createContributionSession(')).map((p) =>
      rel(p).replace('apps/native/src/', ''),
    );
    expect(callers).toEqual([DISCLOSURE_SCREEN]);
  });

  it("annual.tsx's contribute CTA pushes the disclosure route and nothing payment-shaped", () => {
    const annual = read(screenPath(ANNUAL_SCREEN));
    expect(annual).toContain("'/(modal)/fund-disclosure'");
    expect(annual).not.toContain('createContributionSession(');
    expect(annual).not.toContain('openAuthSessionAsync');
  });

  it('the disclosure screen renders every block from DISCLOSURE_BLOCKS', () => {
    // The screen maps the SAME structure this test asserts above — so a fact cannot be
    // dropped from the render without either failing here or failing the structure test.
    const screen = read(screenPath(DISCLOSURE_SCREEN));
    expect(screen).toContain("from '@/lib/fund-disclosure'");
    expect(screen).toContain('DISCLOSURE_BLOCKS.map');
    expect(screen).toContain('block.facts.map');
  });

  it('the disclosure route is registered in the (modal) stack', () => {
    const layout = read(`${SRC}app/(modal)/_layout.tsx`);
    expect(layout).toContain('name="fund-disclosure"');
  });
});

describe('the #222 window-refusal handling survived the move (#375 non-regression)', () => {
  it('the disclosure screen keeps the refusal map, the cycleClosed copy and the edition re-read', () => {
    const screen = read(screenPath(DISCLOSURE_SCREEN));
    expect(screen).toContain("'the cycle is closed'");
    expect(screen).toContain("'edition not found'");
    expect(screen).toContain("'fund.contribute.cycleClosed'");
    expect(screen).toContain('ContributionSessionError');
    expect(screen).toContain('fundKeys.activeEdition()');
    expect(screen).toContain('invalidateQueries');
  });
});
