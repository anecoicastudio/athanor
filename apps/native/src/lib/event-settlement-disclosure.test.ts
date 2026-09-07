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

  it('keeps every server refusal mapped to its own copy', () => {
    // 22003 is #701's floor arm, 42501 is the identity arm, 55000 is #104's payout arm, and
    // create_event and the trigger raise the same three on both write paths. Collapsing any of
    // them into the generic «Riprova» would leave an organiser retrying a form that can never
    // submit. Enumerated rather than spot-checked: this list is what a fourth arm has to join.
    const s = screen();
    expect(s).toContain("setError(t('event.create.verifyGate', locale));");
    for (const code of ['22003', '42501', '55000']) {
      expect(s, `no arm for SQLSTATE ${code}`).toContain(`code === '${code}'`);
    }
    // 23514 is the bare events_price_min CHECK, shared with every other CHECK on `events` and
    // unreachable from this app (nothing here updates a price). An arm on it would mis-describe
    // an online event with no stream_url as a price problem.
    expect(s).not.toContain("code === '23514'");
  });
});

describe('the minimum paid ticket price (#701)', () => {
  it('refuses under the floor BEFORE the schema parse, or the copy is unreachable', () => {
    // eventCreateSchema now carries the same band, and a ZodError has no `code` — so if the guard
    // ran after mutation.mutate(), onError would fall through to the generic «Riprova» and
    // event.create.price.min would never be shown. Order is the assertion.
    const s = screen();
    const guard = s.indexOf('parseEuroToCents(price, MIN_PAID_TICKET_CENTS)');
    const submit = s.indexOf('mutation.mutate();');
    expect(guard, 'the floor guard is gone from onSubmit').toBeGreaterThan(-1);
    expect(submit).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(submit);
  });

  it('takes the floor from the constant, never a literal', () => {
    // The DEFAULT_TICKET_FEE_PCT argument, applied to the second ticket-money constant:
    // ticket-split.mirror.test.ts pins MIN_PAID_TICKET_CENTS against the events_price_min CHECK
    // and both write gates, so importing it is what keeps the sentence true.
    const s = screen();
    expect(s).toContain('MIN_PAID_TICKET_CENTS');
    expect(s).toContain('formatEuroAmount(MIN_PAID_TICKET_CENTS, locale)');
    expect(s).not.toMatch(/price[A-Za-z]*\s*[<>]=?\s*500\b/);
  });

  it('states the floor before it refuses it, in the paid branch', () => {
    // A rule a person meets only as a rejection is a rule the form kept to itself.
    const s = screen();
    const paidBranch = s.slice(s.indexOf('{paid ? ('));
    expect(paidBranch).toContain('{minPriceMessage}');
  });

  it('interpolates the amount in BOTH catalogs and spells no figure in either', () => {
    // A price inside a term is a term. A catalog that hardcodes «5» keeps quoting five euro the
    // day the ruling moves, in one language and not the other.
    for (const lang of ['it', 'en'] as const) {
      const catalog = JSON.parse(
        readFileSync(`${SRC}../../../packages/i18n/src/catalogs/${lang}.json`, 'utf8'),
      ) as Record<string, string>;
      const line = catalog['event.create.price.min'];
      expect(line, `${lang}.json has no event.create.price.min`).toBeDefined();
      expect(line).toContain('{min}');
      expect(line, `${lang} spells the figure instead of interpolating it`).not.toMatch(/\d/);
    }
  });
});
