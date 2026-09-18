import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * #747 — the paid-ticket button was offered for events whose organiser could not be paid, so the
 * tap could only end in a refusal. TicketBar now reads the organiser's payability through
 * `getOrganizerPayoutsEnabled` (the `has_payouts_enabled` RPC) and withdraws the offer on an
 * explicit `false`. Read as text, the source-audit idiom this app uses for UI guarantees.
 */
const SRC = fileURLToPath(new URL('..', import.meta.url).href);
const BAR = readFileSync(`${SRC}components/live/TicketBar.tsx`, 'utf8');

describe('the ticket bar withdraws the offer when the organiser cannot be paid (#747)', () => {
  it("asks about the event's organiser through the boolean wrapper", () => {
    expect(BAR).toContain('getOrganizerPayoutsEnabled(supabase, event.organizer_id)');
    // The destination RPC returns the organiser's Stripe account id; it has no place on a
    // buyer's screen or in a buyer's query cache.
    expect(BAR).not.toContain('organizer_payout_destination');
  });

  it('never hydrates a persisted answer', () => {
    const q = BAR.slice(BAR.indexOf('const payableQ'), BAR.indexOf('const organizerUnpayable'));
    expect(q).toContain('meta: { persist: false }');
  });

  it('withdraws only on an explicit false, and before the buy button renders', () => {
    // `=== false`, so a failed read leaves the server as the authority rather than hiding a
    // button that would have worked.
    expect(BAR).toContain('const organizerUnpayable = payableQ.data === false;');
    const gate = BAR.indexOf('if (organizerUnpayable)');
    const buy = BAR.indexOf("'ticket.buy'");
    expect(gate).toBeGreaterThan(-1);
    expect(buy).toBeGreaterThan(gate);
  });

  it('keeps the button inert while the read is in flight', () => {
    expect(BAR).toContain("disabled={phase === 'opening' || !uid || payableQ.isPending}");
  });

  it('keeps the server refusal mapped — the client gate is a courtesy', () => {
    expect(BAR).toContain("'organizer cannot receive payouts': 'ticket.error.organizerPayouts'");
  });
});
