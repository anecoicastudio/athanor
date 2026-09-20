import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * #806 — paid events had no off-switch. Production has no Stripe Connect, no webhook signing
 * secret and a test-mode account until the swap (#699), so the first Android release must OFFER
 * no paid event at all; and once live mode arrives there must be a way to stop ticket sales
 * without shipping a build. `paid_events_enabled` is that switch, and — like `circle_checkout_
 * enabled` before it (#747) — it has to FAIL CLOSED: an absent row, a failed fetch and a snapshot
 * from yesterday must all mean no offer.
 *
 * Two properties are asserted here, and they fail in different ways:
 *
 *  1. the gate's own fail-closed shape, pinned line by line the way `circle-checkout-gate.test.ts`
 *     pins Circle's — each assertion is one way the gate could quietly fail open;
 *  2. the FLAG NAME across the workspace boundary. `supabase/functions` sits outside the pnpm
 *     workspace and cannot import app code, so the key is spelled twice. Nothing reads across
 *     that line at runtime, so a rename on one side leaves both suites green while the app reads
 *     a row the server never writes a gate for — the drift `ticket-split.mirror.test.ts` exists
 *     to catch on the ticket split, applied to the flag. `apps/native/turbo.json` declares the
 *     server file as a `$TURBO_ROOT$` input, or turbo would replay a cached PASS across exactly
 *     that rename.
 *
 * Source-audit idiom (`environment: 'node'`, nothing renderable is collectable), same as every
 * other UI guarantee in this app.
 */
const SRC = fileURLToPath(new URL('..', import.meta.url).href);
const HOOK = readFileSync(`${SRC}hooks/use-remote-config.ts`, 'utf8');
const COMPOSER = readFileSync(`${SRC}app/(modal)/event-create.tsx`, 'utf8');
const BAR = readFileSync(`${SRC}components/live/TicketBar.tsx`, 'utf8');
const SHARED = readFileSync(
  `${SRC}../../../supabase/functions/_shared/remote-config-gate.ts`,
  'utf8',
);
const TICKET_FN = readFileSync(
  `${SRC}../../../supabase/functions/create-ticket-checkout/logic.ts`,
  'utf8',
);
const PAYOUT_FN = readFileSync(
  `${SRC}../../../supabase/functions/create-payout-onboarding/logic.ts`,
  'utf8',
);

/** The body of `usePaidEventsGate`, so no assertion can pass on a sibling hook in the file. */
const gateBody = (() => {
  const start = HOOK.indexOf('export function usePaidEventsGate');
  expect(start, 'usePaidEventsGate is gone').toBeGreaterThan(-1);
  const next = HOOK.indexOf('\nexport ', start + 1);
  return HOOK.slice(start, next === -1 ? undefined : next);
})();

describe('the paid-events gate fails closed (#806)', () => {
  it('reads the flag by its seeded name', () => {
    expect(HOOK).toContain("PAID_EVENTS_FLAG = 'paid_events_enabled'");
  });

  it('never hydrates a persisted snapshot', () => {
    // The boot read is dehydrated to AsyncStorage for 24h (lib/query-client.ts); sharing its key
    // or dropping the opt-out would paint yesterday's `true` over a rail switched off since.
    expect(gateBody).toContain('remoteConfigKeys.live()');
    expect(gateBody).not.toContain('remoteConfigKeys.boot()');
    expect(gateBody).toContain('meta: { persist: false }');
  });

  it('opens only on a successful read of an explicit true', () => {
    // `=== true` so an absent key (undefined) is closed; `status === 'success'` so a failed
    // refetch — which keeps the stale `data` — is closed too.
    expect(gateBody).toContain("q.status === 'success' && q.data.flags[PAID_EVENTS_FLAG] === true");
  });

  it('resolves rather than hanging when the device is offline', () => {
    // Without `networkMode: 'always'` React Query PAUSES the fetch offline: `status` stays
    // `'pending'`, the gate stays `'loading'`, and everything keyed on it hangs — TicketBar's
    // Buy button dimmed and busy with nothing said, the composer's chip row gone. A `'loading'`
    // that never ends is a hang, not a third state. `payableQ` in TicketBar carries the same
    // flag, with the same note.
    expect(gateBody).toContain("networkMode: 'always'");
  });

  it('shares Circle’s query key, so a second gate is not a second request', () => {
    // `getRemoteConfig` selects the whole table with no key filter, so one cached snapshot answers
    // both gates. A key of its own would double the traffic to read the same rows.
    const circle = HOOK.slice(HOOK.indexOf('export function useCircleCheckoutGate'));
    expect(circle).toContain('remoteConfigKeys.live()');
    expect(HOOK).not.toContain('remoteConfigKeys.paidEvents');
  });
});

describe('the composer offers no paid event while the rail is closed (#806)', () => {
  it('gates the toggle itself, not just the fields below it', () => {
    // The Paid CHIP must disappear. Showing it and refusing the submit is the failure this
    // replaces: a choice that is offered and then rejected reads as a bug in the form.
    expect(COMPOSER).toContain('const paidGate = usePaidEventsGate();');
    expect(COMPOSER).toContain("(paidGate === 'open' ? [false, true] : [false]).map");
  });

  it('never claims the rail is closed before anything has been read', () => {
    // The closed LINE waits for `'closed'` specifically, so a cold start does not show «non
    // ancora aperti» for a beat on a rail that is open. Only the line waits — see below for why
    // the chips must not.
    expect(COMPOSER).toContain("paidGate === 'closed' ?");
    expect(COMPOSER).toContain('event.create.paidClosed');
  });

  it('never blocks the FREE path on the gate, in any state', () => {
    // The regression this pins: a spinner in place of the chip row meant an organiser could not
    // create a free event while the gate was loading — and under a paused offline fetch
    // `'loading'` never ends, so that was forever. Free is in the rendered list unconditionally;
    // only Paid is conditional.
    expect(COMPOSER).toContain("(paidGate === 'open' ? [false, true] : [false]).map");
    expect(COMPOSER).not.toContain("paidGate === 'loading' ?");
    expect(COMPOSER).not.toContain('ActivityIndicator');
  });

  it('falls back to free if the rail closes with the sheet open', () => {
    // A 60s refetch can close the rail mid-composition. `paid` is DERIVED from the gate and the
    // pick, so the price field, the settlement box and the paid half of the payload all go with
    // it in one step. Derived, not reset by an effect: a stored copy of a two-input truth goes
    // stale, and the setState-in-effect that would refresh it is a cascading render the React
    // compiler rejects outright.
    expect(COMPOSER).toContain("const paid = paidGate === 'open' && paidSelected;");
    expect(COMPOSER).not.toContain('setPaid(');
  });

  it('never publishes as FREE an event that was filled in as paid', () => {
    // The submit belt reads the PICK, not the derived value — with the rail closed `paid` is
    // already false, so without this «Pubblica» would quietly create a free event at the price
    // the organiser had typed. It has to say what happened instead.
    expect(COMPOSER).toContain("if (paidSelected && paidGate !== 'open')");
    const guard = COMPOSER.indexOf("if (paidSelected && paidGate !== 'open')");
    const submits = [...COMPOSER.matchAll(/mutation\.mutate\((?!\))[^)]*\);/g)].map((m) => m.index);
    expect(submits.length).toBeGreaterThan(0);
    for (const submit of submits) expect(guard).toBeLessThan(submit as number);
  });

  it('maps the payout function’s own refusal to the same sentence', () => {
    expect(COMPOSER).toContain("code === 'paid events closed'");
    expect(COMPOSER).toContain('event.create.paidClosed');
  });

  it('leaves the free path untouched', () => {
    // The whole point: a closed paid rail must not stop anyone listing a free event. The Free
    // chip is always in the rendered list, whatever the gate says.
    expect(COMPOSER).toContain('? [false, true] : [false]');
    expect(COMPOSER).not.toContain("paidGate === 'open' ? [false, true] : []");
  });
});

describe('the ticket bar withdraws the offer but not the price (#806)', () => {
  it('renders a closed state instead of a Buy button', () => {
    expect(BAR).toContain('const paidGate = usePaidEventsGate();');
    expect(BAR).toContain("if (paidGate === 'closed') {");
    expect(BAR).toContain("t('ticket.error.paidClosed', locale)");
  });

  it('still quotes the price in the closed state', () => {
    // An event that drops its price while closed reads as free. The closed arm must still say
    // what a ticket would cost.
    const arm = BAR.slice(BAR.indexOf("if (paidGate === 'closed') {"));
    const end = arm.indexOf('if (soldOut)');
    expect(end).toBeGreaterThan(-1);
    expect(arm.slice(0, end)).toContain('formatPrice(event.price_cents, event.currency, locale)');
  });

  it('outranks sold-out and the payability arm, and never pre-empts a held ticket', () => {
    // Order is the assertion: «tutto esaurito» and «chi organizza non può ricevere pagamenti» are
    // both the wrong reason when the rail is shut — and a ticket already held stays viewable.
    const held = BAR.indexOf('if (hasTicket) {');
    const closed = BAR.indexOf("if (paidGate === 'closed') {");
    const sold = BAR.indexOf('if (soldOut) {');
    const unpayable = BAR.indexOf('if (organizerUnpayable) {');
    for (const [name, idx] of [
      ['hasTicket', held],
      ['paidGate', closed],
      ['soldOut', sold],
      ['organizerUnpayable', unpayable],
    ] as const) {
      expect(idx, `${name} arm is gone`).toBeGreaterThan(-1);
    }
    expect(held).toBeLessThan(closed);
    expect(closed).toBeLessThan(sold);
    expect(closed).toBeLessThan(unpayable);
  });

  it('holds the buy button inert while the gate is still loading', () => {
    expect(BAR).toContain("paidGate === 'loading'");
  });
});

describe('the flag key mirrors across the workspace boundary (#806)', () => {
  it('the server names the same row the app reads', () => {
    // The whole reason this file reads six sources: neither side can import the other, so this
    // equality is asserted or it is not asserted at all.
    expect(SHARED).toContain("PAID_EVENTS_FLAG = 'paid_events_enabled'");
    expect(HOOK).toContain("PAID_EVENTS_FLAG = 'paid_events_enabled'");
  });

  it('spells the key exactly once on each side, so there is one thing to rename', () => {
    const quoted = (s: string) => [...s.matchAll(/'paid_events_enabled'/g)].length;
    expect(quoted(SHARED), 'the server spells the key more than once').toBe(1);
    expect(quoted(HOOK), 'the app spells the key more than once').toBe(1);
  });

  it('both money functions read the flag through the shared fail-closed reader', () => {
    // Not a local copy of the ladder in either: three copies of a fail-closed read is three
    // chances for one of them to grow an `||`.
    for (const [name, source] of [
      ['create-ticket-checkout', TICKET_FN],
      ['create-payout-onboarding', PAYOUT_FN],
    ] as const) {
      expect(source, `${name} does not import the shared reader`).toContain(
        "from '../_shared/remote-config-gate.ts'",
      );
      expect(source, `${name} does not read the flag`).toContain(
        'readFlagGate(userClient, PAID_EVENTS_FLAG)',
      );
      expect(source, `${name} does not refuse on a closed gate`).toContain(
        "return error('paid events closed', 403);",
      );
    }
  });

  it('the server refuses BEFORE it does anything else', () => {
    // A gate that runs after the event read has already leaked which events exist; after the seat
    // claim it holds a 35-minute seat on a rail that cannot sell. Pinned by position.
    const gate = TICKET_FN.indexOf('readFlagGate(userClient, PAID_EVENTS_FLAG)');
    for (const after of [".from('events')", "rpc('claim_event_seat'", 'createCheckoutSession(']) {
      const idx = TICKET_FN.indexOf(after);
      expect(idx, `${after} is gone from the ladder`).toBeGreaterThan(-1);
      expect(gate, `the flag is read after ${after}`).toBeLessThan(idx);
    }
    const payoutGate = PAYOUT_FN.indexOf('readFlagGate(userClient, PAID_EVENTS_FLAG)');
    for (const after of [
      "rpc('is_identity_verified'",
      'createAccount(',
      'payout onboarding not configured',
    ]) {
      const idx = PAYOUT_FN.indexOf(after);
      expect(idx, `${after} is gone from the ladder`).toBeGreaterThan(-1);
      expect(payoutGate, `the flag is read after ${after}`).toBeLessThan(idx);
    }
  });

  it('the refusal string is the one the bar maps', () => {
    // `ticket-error-copy.test.ts` proves every 4xx has a sentence; this proves the two files
    // agree on THIS one, which is the pair a rename would split.
    expect(TICKET_FN).toContain("error('paid events closed', 403)");
    expect(BAR).toContain("'paid events closed': 'ticket.error.paidClosed',");
  });
});
