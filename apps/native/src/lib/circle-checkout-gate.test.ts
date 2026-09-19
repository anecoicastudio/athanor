import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * #747 — the Circle purchase CTA was live on production while production's Stripe was still in
 * test mode, so a member could tap into a Checkout that cannot complete. The CTA now hangs off
 * the `circle_checkout_enabled` remote_config row, and that gate has to FAIL CLOSED: an absent
 * row, a failed fetch and a snapshot from yesterday must all mean no button.
 *
 * Each property below is one way the gate could quietly fail open, so each is pinned. The hook
 * and the screen are read as text — the source-audit idiom this app uses for UI guarantees
 * (`environment: 'node'`, nothing renderable is collectable).
 */
const SRC = fileURLToPath(new URL('..', import.meta.url).href);
const HOOK = readFileSync(`${SRC}hooks/use-remote-config.ts`, 'utf8');
const SCREEN = readFileSync(`${SRC}app/(modal)/circle.tsx`, 'utf8');

/** The body of `useCircleCheckoutGate`, so assertions cannot pass on the boot read above it. */
const gateBody = (() => {
  const start = HOOK.indexOf('export function useCircleCheckoutGate');
  expect(start, 'useCircleCheckoutGate is gone').toBeGreaterThan(-1);
  // Bounded at the next export, so an assertion cannot pass on code added after the gate.
  const next = HOOK.indexOf('\nexport ', start + 1);
  return HOOK.slice(start, next === -1 ? undefined : next);
})();

describe('the Circle checkout gate fails closed (#747)', () => {
  it('reads the flag by its seeded name', () => {
    expect(HOOK).toContain("CIRCLE_CHECKOUT_FLAG = 'circle_checkout_enabled'");
  });

  it('never hydrates a persisted snapshot', () => {
    // The boot read is dehydrated to AsyncStorage for 24h; sharing its key or dropping the
    // opt-out would paint yesterday's `true` before any fetch.
    expect(gateBody).toContain('remoteConfigKeys.live()');
    expect(gateBody).not.toContain('remoteConfigKeys.boot()');
    expect(gateBody).toContain('meta: { persist: false }');
  });

  it('opens only on a successful read of an explicit true', () => {
    // `=== true` so an absent key (undefined) is closed; `status === 'success'` so a failed
    // refetch, which keeps the old data, is closed too.
    expect(gateBody).toContain(
      "q.status === 'success' && q.data.flags[CIRCLE_CHECKOUT_FLAG] === true",
    );
  });

  it('gates every purchase control on the screen', () => {
    // #759 folds the «already subscribed» refusal in: a member the server refused is offered
    // nothing to buy either.
    expect(SCREEN).toContain(
      "const canSubscribe = Platform.OS !== 'ios' && checkoutGate === 'open' && !alreadySubscribed;",
    );
    // The price read, the price toggle and the renewal disclosure.
    expect(SCREEN).toContain('enabled: !isMember && canSubscribe');
    expect(SCREEN.match(/\{canSubscribe \? \(/g)?.length).toBeGreaterThanOrEqual(2);
    // The CTA arm: the closed line renders before the Join button can be reached.
    const closed = SCREEN.indexOf("checkoutGate === 'closed'");
    const cta = SCREEN.indexOf("'circle.cta.monthly'");
    expect(closed).toBeGreaterThan(-1);
    expect(cta).toBeGreaterThan(closed);
    expect(SCREEN).toContain("t('circle.checkoutClosed', locale)");
  });

  it('no Platform check stands in for the flag outside the iOS copy arm', () => {
    // Before #747 the price toggle and the renewal line keyed on `Platform.OS !== 'ios'` alone;
    // one left behind would reopen a surface of the offer on Android with the flag off.
    expect(SCREEN).not.toContain("Platform.OS !== 'ios' ? (");
  });

  it("maps the server's closed refusal to the closed line, not to an error", () => {
    // The server gate (create-circle-checkout) refuses with this stable code; a client whose
    // read said open inside the 60s window must end on the closed line, not «Qualcosa non ha
    // funzionato».
    expect(SCREEN).toContain(
      "e instanceof CircleCheckoutError && e.code === 'circle checkout closed'",
    );
    expect(SCREEN).toContain("const checkoutGate = serverClosed ? 'closed' : clientGate;");
  });
});
