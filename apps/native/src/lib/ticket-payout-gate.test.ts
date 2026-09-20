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
    // `=== false`, so a first read that fails leaves the server as the authority rather than
    // hiding a button that would have worked. (A failed REFETCH keeps its old data, so an offer
    // already withdrawn stays withdrawn — TanStack keeps `data` across an error.)
    expect(BAR).toContain('const organizerUnpayable = payableQ.data === false;');
    const gate = BAR.indexOf('if (organizerUnpayable)');
    const buy = BAR.indexOf("'ticket.buy'");
    expect(gate).toBeGreaterThan(-1);
    expect(buy).toBeGreaterThan(gate);
  });

  it('keeps the button inert while the read is in flight, and never for long', () => {
    // #806 folded the paid-events flag into the same flag: BOTH reads can withdraw the offer, so
    // a tap while either is still in flight would reach a server that may refuse. The payout half
    // stays pinned verbatim inside the expression — this is the #747 guard widened, not relaxed.
    expect(BAR).toContain(
      "const checking = (!!uid && payableQ.isPending) || paidGate === 'loading';",
    );
    expect(BAR).toContain("disabled={phase === 'opening' || !uid || checking}");
    // …and visibly so: dimmed and busy, not a lit button that ignores the tap.
    expect(BAR).toContain("checking ? ' opacity-40' : ''");
    expect(BAR).toContain('busy: checking');
    // A pending read holds the button dead, so it must settle fast: no retry ladder, and no
    // offline pause (which would hold it dead indefinitely with nothing said).
    const q = BAR.slice(BAR.indexOf('const payableQ'), BAR.indexOf('const organizerUnpayable'));
    expect(q).toContain('retry: false');
    expect(q).toContain("networkMode: 'always'");
  });

  it('keeps the server refusal mapped — the client gate is a courtesy', () => {
    expect(BAR).toContain("'organizer cannot receive payouts': 'ticket.error.organizerPayouts'");
  });
});
