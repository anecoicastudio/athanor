import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { verifyQrToken } from '../_shared/qr.ts';
import { error, json } from '../_shared/respond.ts';

// Check-in verdict ladder extracted from index.ts so it is unit-testable (deno test):
// index.ts keeps the transport shell (OPTIONS/method guard, requireUser, body parse,
// env + client construction) and injects everything here (repo convention: DI over mocks).

export type CheckInCtx = {
  /** service role — cross-user reads + the money flip */
  admin: SupabaseClient;
  /** the scanner's own client — RLS is the second organizer gate on the attendance insert */
  userClient: SupabaseClient;
  qrSecret: string;
};

export type CheckInInput = {
  scannerId: string;
  eventId: string;
  qrToken: string;
};

/**
 * Verdict gates in order (see index.ts JSDoc):
 *   1) HMAC verify the token (offline-of-Stripe)         → invalid
 *   2) token.eid === eventId (scanner's own event)       → wrongEvent
 *   3) caller is the event's organizer                   → 403
 *   4) ticket exists & is paid|checked_in                → invalid
 * Then: record attendance (user client → RLS 2nd organizer gate, idempotent on ticket_id)
 * and flip event_tickets paid→checked_in as SERVICE ROLE. Re-scan → 'already'.
 * NEVER writes Aura (the +15/+30 is M6 — 07). Every scan verdict is a 200.
 */
export async function processCheckIn(ctx: CheckInCtx, input: CheckInInput): Promise<Response> {
  const { admin, userClient, qrSecret } = ctx;
  const { scannerId, eventId, qrToken } = input;

  // 1) HMAC verify — verifyQrToken NEVER throws; null on any malformed/forged token.
  const payload = await verifyQrToken(qrToken, qrSecret);
  if (!payload) return json({ result: 'invalid' });

  // 2) event match — the token must belong to the event the organizer is scanning for.
  if (payload.eid !== eventId) return json({ result: 'wrongEvent' });

  // 3) organizer gate (code-level; RLS on the insert is the second gate).
  const { data: event, error: evErr } = await admin
    .from('events')
    .select('id,organizer_id')
    .eq('id', eventId)
    .is('deleted_at', null)
    .maybeSingle();
  if (evErr) return error('event lookup failed', 500);
  if (!event) return error('event not found', 404);
  if (event.organizer_id !== scannerId) return error('forbidden', 403);

  // 4) the ticket (service role — the organizer can't read another user's ticket via RLS).
  const { data: ticket, error: tErr } = await admin
    .from('event_tickets')
    .select('id,status')
    .eq('event_id', eventId)
    .eq('user_id', payload.uid)
    .maybeSingle();
  if (tErr) return error('ticket lookup failed', 500);
  if (!ticket || (ticket.status !== 'paid' && ticket.status !== 'checked_in')) {
    return json({ result: 'invalid' }); // no ticket, pending, or refunded
  }

  // holder handle for the «✓ {name} · benvenuto» toast (members-readable; admin keeps it simple).
  const { data: holder } = await admin
    .from('profiles')
    .select('handle')
    .eq('id', payload.uid)
    .maybeSingle();
  const name = holder?.handle ?? undefined;

  // already checked in (fast path before attempting a write).
  if (ticket.status === 'checked_in') return json({ result: 'already', name });

  // record attendance on the CALLER's client → RLS organizer WITH CHECK is the 2nd gate.
  // ignoreDuplicates makes a concurrent double-scan a no-op; .select() tells us if a row was new.
  const { data: inserted, error: insErr } = await userClient
    .from('event_attendance')
    .upsert(
      { ticket_id: ticket.id, event_id: eventId, scanned_by: scannerId },
      { onConflict: 'ticket_id', ignoreDuplicates: true },
    )
    .select('id');
  if (insErr) {
    // 42501 = RLS denied (caller is not the organizer) — should be unreachable past gate 3, but
    // treat it as forbidden rather than leaking a 500.
    if ((insErr as { code?: string }).code === '42501') return error('forbidden', 403);
    return error('check-in failed', 500);
  }
  const wasNew = (inserted?.length ?? 0) > 0;

  // flip the ticket paid→checked_in as SERVICE ROLE (idempotent; conditioned on status='paid').
  const { error: flipErr } = await admin
    .from('event_tickets')
    .update({ status: 'checked_in' })
    .eq('id', ticket.id)
    .eq('status', 'paid');
  if (flipErr) console.error('ticket flip failed', ticket.id, flipErr); // attendance is the truth; best-effort

  return json({ result: wasNew ? 'valid' : 'already', name });
}
