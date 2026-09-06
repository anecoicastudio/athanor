import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DEFAULT_TICKET_FEE_PCT, ticketSplit } from './ticket-split';

/**
 * #104 — the ticket split exists in three places, and only one of them is authoritative.
 *
 *   1. `events.fee_pct`, `numeric(5,2) not null default 10.00` — the rate a live event prices from
 *   2. `create-ticket-checkout/logic.ts` — the Deno copy that computes what STRIPE is told
 *   3. `packages/core/src/events/ticket-split.ts` — the copy the composer quotes to the organiser
 *
 * (2) is the authority: the server computes the `application_fee_amount` that actually moves money.
 * (3) is disclosure. `supabase/functions` sits outside the pnpm workspace and cannot import
 * `@athanor/core`, so the duplication is deliberate — the same shape as `fund/fees.ts` and
 * `create-contribution-session`, and this file is its guard.
 *
 * The failure this closes is the one the fund rail already learned about the hard way: both sides
 * pinning the same literal in their OWN suite is two independent claims about one number, not a
 * comparison of anything. Nothing reads across the boundary, so the two drift and every test stays
 * green while the composer promises an organiser one rate and Stripe applies another. On a legal
 * disclosure that is a change of terms nobody authored.
 *
 * The column default is pinned too, and it is the piece with no other guard at all: the composer
 * quotes `DEFAULT_TICKET_FEE_PCT` BEFORE an event row exists, so if someone widened the default in
 * a later migration the app would keep quoting ten percent at events created at the new rate.
 */
/**
 * Found by walking UP, not by counting `../`: Stryker runs this package's suite from a sandbox copy
 * two levels deeper than the package sits in the repo, where a fixed relative path resolves to
 * `packages/core/supabase/...` and kills the dry run. (`fees.mirror.test.ts`,
 * `affinity.mirror.test.ts` and `version.mirror.test.ts` carry the same note.)
 *
 * The segment list for the LOCAL file keeps its `packages/core/` prefix on purpose. Stryker mutates
 * `ticket-split.ts`, so this reads a file inside its own mutate glob: the prefix is what makes the
 * climb pass the sandbox and land on the pristine repo copy rather than the instrumented one.
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
  above('supabase', 'functions', 'create-ticket-checkout', 'logic.ts'),
  'utf8',
);
const SELF_SOURCE = readFileSync(
  above('packages', 'core', 'src', 'events', 'ticket-split.ts'),
  'utf8',
);
const EVENTS_MIGRATION = readFileSync(
  above('supabase', 'migrations', '20260615094844_events.sql'),
  'utf8',
);

/** Drop comments, collapse whitespace: compare the code, not the prose or the formatting. */
function code(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

/** A bare `export const NAME = <number>;`, as a number. */
function constant(source: string, name: string, where: string): number {
  const found = source.match(new RegExp(`^export const ${name} = (\\d[\\d_.]*);`, 'm'))?.[1];
  if (found === undefined) throw new Error(`${where} declares no numeric const ${name}`);
  return Number(found.replaceAll('_', ''));
}

/**
 * The whole body of `ticketSplit`, from its signature to the first column-0 closing brace. Unlike
 * `fees.mirror.test.ts` there is NO documented divergence here: the two copies are byte-identical
 * code, validation included, so the comparison covers the guards as well as the arithmetic.
 */
function splitBody(source: string, where: string): string {
  const start = source.search(/^export function ticketSplit\(/m);
  if (start < 0) throw new Error(`${where} declares no exported function ticketSplit`);
  // Anchored on the RETURN TYPE, not on the first column-0 `}`: the parameter object is destructured
  // across lines, so `}: {` sits at column 0 inside the signature and the naive scan stops there —
  // yielding a body with no arithmetic in it at all. Both copies would truncate identically and the
  // equality assertion would still pass, which is precisely why the extraction is pinned to content
  // above. This is the version that survives that pin.
  const open = source.indexOf('): TicketSplit {', start);
  if (open < 0) throw new Error(`${where}'s ticketSplit has no '): TicketSplit {' opener`);
  let depth = 0;
  for (let i = open + '): TicketSplit '.length; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) return code(source.slice(start, i + 1));
    }
  }
  throw new Error(`${where}'s ticketSplit body is unbalanced`);
}

describe('the ticket split mirrors create-ticket-checkout and the fee_pct column', () => {
  // Every comparison below extracts both halves by regex from two files. A silently-empty
  // extraction would make `'' === ''` pass and leave the guard decorative, so the extraction is
  // pinned to content before anything is compared against anything.
  it('extracts a non-trivial ticketSplit from both sides', () => {
    for (const [where, source] of [
      ['packages/core/src/events/ticket-split.ts', SELF_SOURCE],
      ['supabase/functions/create-ticket-checkout/logic.ts', MIRROR_SOURCE],
    ] as const) {
      const body = splitBody(source, where);
      // The clamp is what keeps a mis-set rate from minting a Session Stripe rejects; the rounding
      // is what decides which side the half-cent lands on. Both are what a broken extraction would
      // stop guarding, so both are named here.
      expect(body, where).toContain('Math.round((priceCents * feePct) / 100)');
      expect(body, where).toContain('Math.min(');
      expect(body.length, where).toBeGreaterThan(200);
    }
  });

  it('the split is the same code on both sides, guards included', () => {
    expect(splitBody(MIRROR_SOURCE, 'the Deno mirror')).toBe(
      splitBody(SELF_SOURCE, 'packages/core'),
    );
  });

  it('DEFAULT_TICKET_FEE_PCT is the same number on both sides', () => {
    expect(constant(MIRROR_SOURCE, 'DEFAULT_TICKET_FEE_PCT', 'the Deno mirror')).toBe(
      DEFAULT_TICKET_FEE_PCT,
    );
  });

  it('DEFAULT_TICKET_FEE_PCT is the events.fee_pct column default', () => {
    // `fee_pct numeric(5,2) not null default 10.00 check (fee_pct between 0 and 100)`. Read from
    // the creating migration, which is append-only and therefore still the declaration in force —
    // if a later migration ever alters the default, this is the assertion that has to be moved
    // deliberately rather than the app quietly quoting a stale rate.
    const declared = EVENTS_MIGRATION.match(
      /^\s*fee_pct\s+numeric\(5,2\)\s+not null\s+default\s+([\d.]+)/m,
    )?.[1];
    expect(declared, 'events.fee_pct no longer declares a numeric default').toBeDefined();
    expect(Number(declared)).toBe(DEFAULT_TICKET_FEE_PCT);
  });

  it('the column still bounds the rate the clamp assumes', () => {
    // ticketSplit clamps to [0, price] rather than trusting the input. That clamp is the belt; the
    // CHECK is the braces, and the two are only consistent while the CHECK exists.
    expect(EVENTS_MIGRATION).toMatch(/check \(fee_pct between 0 and 100\)/);
  });

  it('both sides still name each other, so the pair stays reviewable', () => {
    expect(MIRROR_SOURCE).toContain('packages/core/src/events/ticket-split.ts');
    expect(SELF_SOURCE).toContain('create-ticket-checkout');
  });

  // Cheap, and it is what the imported copy is FOR: the text comparison proves the two agree, this
  // proves what they agree ON is a split that conserves the money at the default rate.
  it('the imported copy conserves the money at the default rate', () => {
    const { priceCents, applicationFeeCents, organiserCents } = ticketSplit({
      priceCents: 1500,
      feePct: DEFAULT_TICKET_FEE_PCT,
    });
    expect(applicationFeeCents + organiserCents).toBe(priceCents);
    expect(applicationFeeCents).toBe(150);
  });
});
