import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

/**
 * The fail-closed half of `remote_config`, shared by every money rail that can be switched off
 * from the table (#747 for Circle, #806 for paid events).
 *
 * Deliberately the OPPOSITE of `version-gate.ts`, which reads the same table and fails OPEN: that
 * one guards a courtesy check and must never take check-in or payments down. These flags guard a
 * hosted Checkout whose keys may still be test-mode, so every doubt — an absent row, a malformed
 * value, a read that errored — means closed. A rail that cannot prove it is open is shut.
 *
 * Read through the CALLER's client in every caller: `remote_config` is SELECT-granted to `anon`
 * and `authenticated` with a `using (true)` policy (`20260621085342_remote_config.sql`), and
 * `_shared/auth-posture.test.ts` forbids the service role in a user-callable function. No
 * per-isolate cache here, unlike `version-gate.ts`: one PK select is cheap next to the Stripe
 * calls these gates stand in front of, and an operator flipping a rail off wants it off now, not
 * within a TTL.
 */

/** The remote_config row that opens Circle checkout (#747). Absent on production until the Stripe cutover. */
export const CIRCLE_CHECKOUT_FLAG = 'circle_checkout_enabled';

/**
 * The remote_config row that opens paid events (#806) — ticket checkout and payout onboarding
 * alike. Absent on production until the ticket rail is proven live (RELEASE-RUNBOOK §4.2 step 8,
 * after §4.8's rail proof), so the first Android release offers no paid event at all.
 *
 * MIRRORED in `apps/native/src/hooks/use-remote-config.ts` as `PAID_EVENTS_FLAG`:
 * `supabase/functions` is outside the pnpm workspace and cannot import app code, so the key is
 * duplicated and `apps/native/src/lib/paid-events-gate.test.ts` reads both files as text to keep
 * them equal — the house answer to this boundary (`ticket-split.mirror.test.ts`).
 */
export const PAID_EVENTS_FLAG = 'paid_events_enabled';

/** Why a gate is shut. `off` is an explicit `{"enabled":false}`; the rest are doubt. */
export type FlagClosedReason = 'read-error' | 'absent' | 'malformed' | 'off';

export type FlagGate = { open: true } | { open: false; reason: FlagClosedReason };

/**
 * Whether `flag` is open: `true` only on a clean read of `{"enabled": true}`.
 *
 * The error arm wins over any payload that rode along with it — a read that failed proved
 * nothing, whatever PostgREST also handed back. `=== true` rather than a truthy test, so
 * `{"enabled": "true"}` and `{"enabled": 1}` are malformed rather than open.
 */
export async function readFlagGate(userClient: SupabaseClient, flag: string): Promise<FlagGate> {
  const { data, error: readError } = await userClient
    .from('remote_config')
    .select('value')
    .eq('key', flag)
    .maybeSingle();
  if (readError) return { open: false, reason: 'read-error' };
  if (data == null) return { open: false, reason: 'absent' };
  const value = (data as { value?: unknown }).value;
  if (typeof value !== 'object' || value === null) return { open: false, reason: 'malformed' };
  const enabled = (value as { enabled?: unknown }).enabled;
  if (typeof enabled !== 'boolean') return { open: false, reason: 'malformed' };
  return enabled ? { open: true } : { open: false, reason: 'off' };
}

/** Where a refusal line goes. `console.error` reaches the function logs, the only place an operator looks. */
export type RefusalSink = (line: string) => void;

export const consoleRefusalSink: RefusalSink = (line) => console.error(line);

/**
 * One line per closed refusal, naming the rail, the function and why — the `logPriceRefusal`
 * convention. Configuration only: no profile id, no email, nothing a member typed. `off` and
 * `absent` are the EXPECTED states on production before a cutover, so they log the same one line
 * and nothing louder.
 */
export function logFlagClosed(
  refusal: { tag: string; fn: string; message: string; flag: string; reason: FlagClosedReason },
  sink: RefusalSink = consoleRefusalSink,
): void {
  const { tag, fn, message, flag, reason } = refusal;
  sink(`[${tag}] ${fn}: ${message} ${JSON.stringify({ flag, reason })}`);
}
