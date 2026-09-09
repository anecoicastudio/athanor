import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DEFAULT_TICKET_FEE_PCT, MIN_PAID_TICKET_CENTS, ticketSplit } from './ticket-split';

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
/**
 * #701's floor has FOUR homes, one more than the fee: the declaration in `@athanor/schemas` (the
 * Zod band has to read it and `schemas` is the dependency leaf), the re-export next door in
 * `ticket-split.ts`, the Deno copy, and the migration — which spells the literal three times over,
 * once in the CHECK and once in each of the two write gates. All six numbers are pinned below.
 */
const SCHEMAS_SOURCE = readFileSync(above('packages', 'schemas', 'src', 'event.ts'), 'utf8');
const MIN_PRICE_MIGRATION = readFileSync(
  above('supabase', 'migrations', '20260907145152_events_min_paid_ticket_price.sql'),
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

  // ── #701, the paid-ticket floor: four homes, six literals ────────────────────────────────────
  // The extraction is pinned before anything is compared, for the reason the fee's is: a regex
  // that silently matches nothing turns every assertion below into `undefined === undefined`.
  it('finds a floor literal in each of the four homes', () => {
    expect(SCHEMAS_SOURCE).toMatch(/^export const MIN_PAID_TICKET_CENTS = \d+;$/m);
    expect(MIRROR_SOURCE).toMatch(/^export const MIN_PAID_TICKET_CENTS = \d+;$/m);
    // The core copy is a RE-EXPORT, so `constant()` cannot see it and the imported value is what
    // there is to compare — this asserts the re-export exists at all, which is what makes
    // `@athanor/core` the composer's single source for both ticket-money constants.
    expect(SELF_SOURCE).toMatch(/^export \{ MIN_PAID_TICKET_CENTS \};$/m);
    expect(SELF_SOURCE).toMatch(/from '@athanor\/schemas'/);
    expect(MIN_PRICE_MIGRATION).toMatch(/constraint events_price_min check \(/);
  });

  it('the declaration, the Deno copy and the import are the same number', () => {
    expect(constant(SCHEMAS_SOURCE, 'MIN_PAID_TICKET_CENTS', '@athanor/schemas')).toBe(
      MIN_PAID_TICKET_CENTS,
    );
    expect(constant(MIRROR_SOURCE, 'MIN_PAID_TICKET_CENTS', 'the Deno mirror')).toBe(
      MIN_PAID_TICKET_CENTS,
    );
  });

  it('the CHECK constraint carries the same floor, and still admits a free event', () => {
    // Both halves. A CHECK narrowed to `price_cents >= 500` would read as a floor and be a ban on
    // free events — the band is the whole ruling, so the `= 0 or` is asserted, not assumed.
    const check = MIN_PRICE_MIGRATION.match(
      /constraint events_price_min check \(price_cents = 0 or price_cents >= (\d+)\)/,
    );
    expect(
      check,
      'events_price_min no longer declares the band `price_cents = 0 or >= N`',
    ).not.toBeNull();
    expect(Number(check?.[1])).toBe(MIN_PAID_TICKET_CENTS);
  });

  it('both write gates refuse at the same floor the CHECK does', () => {
    // The RPC arm and the trigger twin, #448's rule: both write paths refuse identically. Each
    // spells the literal itself, because a migration is append-only and cannot read a constant.
    const rpcArm = MIN_PRICE_MIGRATION.match(/if p_price_cents < (\d+) then/);
    const triggerArm = MIN_PRICE_MIGRATION.match(/if new\.price_cents < (\d+) then/);
    expect(rpcArm, 'create_event no longer carries a floor arm').not.toBeNull();
    expect(triggerArm, 'enforce_paid_event_gate no longer carries a floor arm').not.toBeNull();
    expect(Number(rpcArm?.[1])).toBe(MIN_PAID_TICKET_CENTS);
    expect(Number(triggerArm?.[1])).toBe(MIN_PAID_TICKET_CENTS);
  });

  it('both gates raise the SAME errcode, so one client arm covers both write paths', () => {
    // #448's property, and the reason the composer needs one mapping rather than two. 22003 is
    // asserted by VALUE here because the catalog copy is chosen from it in event-create.tsx.
    const raises = [
      ...MIN_PRICE_MIGRATION.matchAll(
        /'paid ticket below the minimum price'\s+using errcode = '(\w+)'/g,
      ),
    ];
    expect(raises.length, 'expected the floor raise in both create_event and the trigger').toBe(2);
    expect(new Set(raises.map((m) => m[1]))).toEqual(new Set(['22003']));
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
