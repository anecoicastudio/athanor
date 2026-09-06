import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * #437 — the settlement acknowledgement in the event composer, asserted the source-audit way.
 *
 * This app has no component harness (vitest runs `environment: 'node'` over `*.test.ts`, so
 * nothing that renders is collectable), which is why every UI guarantee in this repo is a claim
 * about screen source. The same idiom as fund-disclosure.test.ts, and for the same reason: the
 * properties below are legal-shaped rather than cosmetic, so they are asserted rather than
 * reviewed.
 *
 * What this file does NOT prove is that a paid event is refused without the tick — that is
 * create_event's job and the pgTAP file's, deliberately, because the composer is not where it can
 * be enforced. See the migration header.
 */
const SRC = fileURLToPath(new URL('..', import.meta.url).href);
const screen = () => readFileSync(`${SRC}app/(modal)/event-create.tsx`, 'utf8');

describe('the settlement acknowledgement (#437)', () => {
  it('initialises the box to false', () => {
    // CRD 2011/83/EU Art. 22 excludes pre-ticked boxes. `useState(true)` here would be a legal
    // defect rather than a UX preference — the acknowledgement's whole value is that it was given.
    expect(screen()).toContain('const [settlementAck, setSettlementAck] = useState(false);');
  });

  it('persists the tick nowhere', () => {
    // A remembered tick is a pre-ticked box under another name, and the ruling is explicit that
    // the record is PER EVENT: the second event an organiser lists would otherwise arrive already
    // acknowledged, which is the gap this issue is about.
    const s = screen();
    expect(s).not.toContain('AsyncStorage');
    expect(s).not.toContain('SecureStore');
    expect(s).not.toContain('MMKV');
  });

  it('sends the server a boolean, never a timestamp', () => {
    // The column is stamped by create_event from now(). A client-supplied timestamp is evidence
    // of nothing, so the screen must never put one in the payload — the key form is asserted, not
    // the bare name, which the file's own comments mention.
    const s = screen();
    expect(s).toContain('settlement_ack: paid && settlementAck');
    expect(s).not.toContain('settlement_ack_at:');
    expect(s).not.toMatch(/settlementAck[^)]*toISOString/);
  });

  it('renders the disclosure through the catalog, at the price field', () => {
    const s = screen();
    for (const key of [
      'event.create.settlement.ack',
      'event.create.settlement.split',
      'event.create.settlement.required',
    ]) {
      expect(s, `missing ${key}`).toContain(key);
    }
    // Inside the `{paid ? … : null}` branch: the disclosure sits where the decision is made.
    const paidBranch = s.slice(s.indexOf('{paid ? ('));
    expect(paidBranch).toContain('event.create.settlement.ack');
  });

  it('states the commission, and takes the rate from the constant rather than a literal', () => {
    // This assertion is the INVERSE of the one it replaces. That version read "carries no claim of
    // a platform commission", on the grounds that Athanor took 0% and `fee_pct` was dead config.
    // The 2026-09-06 ruling on #104 made the fee real, so silence about it became the defect: an
    // organiser now consents to a deduction, and a consent box that does not name it is worse than
    // no box. The rate must come from DEFAULT_TICKET_FEE_PCT — which ticket-split.mirror.test.ts
    // pins against the events.fee_pct column default — so it cannot drift from what Stripe applies.
    const s = screen();
    expect(s).toContain('DEFAULT_TICKET_FEE_PCT');
    expect(s).toContain('{ pct: DEFAULT_TICKET_FEE_PCT }');
    // The old zero-commission key stays deleted; it now describes the opposite of the truth.
    expect(s).not.toContain('event.create.feeNote');
  });

  it('offers the payout onboarding the paid path now requires', () => {
    // #104's gate refuses a paid event whose organiser has no payable connected account. A refusal
    // with no next action is the failure this block exists to prevent, so the CTA is asserted
    // beside the copy: the screen must both name the missing step and open the flow that fixes it.
    const s = screen();
    expect(s).toContain('event.create.payout.gate');
    expect(s).toContain('event.create.payout.cta');
    expect(s).toContain('requestPayoutOnboarding');
    // openAuthSessionAsync, never a native Stripe module: one would break App Store Expo Go, which
    // is the only surface that reaches testers (rules/mobile.md). The absence of the native module
    // is NOT asserted here — source-audit.test.ts already pins it across the whole import graph,
    // which is the stronger claim, and naming the package here would itself trip that guard.
    expect(s).toContain('WebBrowser.openAuthSessionAsync');
  });

  it('refetches the payout flag on focus, because the redirect proves nothing', () => {
    // payouts_enabled is flipped by stripe-webhook's account.updated arm (W13), not by Stripe's
    // redirect. Without the focus refetch the CTA would sit there after a completed onboarding,
    // and the organiser would have no way to tell that they were done.
    const s = screen();
    expect(s).toContain('useFocusEffect');
    expect(s).toContain('payoutKeys.mine()');
    // And the flag may never be served from the persisted cache: a rehydrated "all set" would
    // paint over an account Stripe has since put back into review.
    expect(s).toContain('meta: { persist: false }');
  });

  it('keeps both server refusals mapped to their own copy', () => {
    // 42501 is the identity arm, 55000 is #104's payout arm, and create_event and the trigger raise
    // the same pair on both write paths. Collapsing either into the generic «Riprova» would leave
    // an organiser retrying a form that can never submit.
    const s = screen();
    expect(s).toContain("setError(t('event.create.verifyGate', locale));");
    expect(s).toContain("code === '55000'");
    expect(s).toContain("code === '42501'");
  });
});
