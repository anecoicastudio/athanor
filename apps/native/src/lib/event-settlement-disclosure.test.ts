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
      'event.create.settlement.manual',
      'event.create.settlement.required',
    ]) {
      expect(s, `missing ${key}`).toContain(key);
    }
    // Inside the `{paid ? … : null}` branch: the disclosure sits where the decision is made.
    const paidBranch = s.slice(s.indexOf('{paid ? ('));
    expect(paidBranch).toContain('event.create.settlement.ack');
  });

  it('carries no claim of a platform commission', () => {
    // `event.create.feeNote` («la piattaforma trattiene una piccola commissione») was deleted with
    // this change: Athanor takes 0% at launch and `fee_pct` is dead config, so it described a
    // deduction nobody takes, beside copy that names the one deduction that is real.
    expect(screen()).not.toContain('event.create.feeNote');
  });

  it('keeps the paid-event gate that makes this dormant', () => {
    // Opening the paid path is #416/M9's decision, not this issue's. The disclosure ships behind
    // a closed gate on purpose; the server-side refusal is what makes it real in the meantime. If
    // this assertion is what fails, read the migration header before deleting it.
    expect(screen()).toContain("setError(t('event.create.verifyGate', locale));");
  });
});
