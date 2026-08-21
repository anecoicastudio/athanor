import { type WaitlistInsert, waitlistInsertSchema } from '@athanor/schemas';
import type { AthanorClient } from './client';

// The public write boundary of the pre-launch waitlist — what the landing's form calls. The
// admin readers (count, keyset page) live in admin.ts since #335, with the panel's other reads.

/**
 * The SQLSTATE the `email_waitlist_throttle` trigger raises when an address is over its budget.
 *
 * `PT429` and not a bare `raise exception`: PostgREST maps a `PTxxx` SQLSTATE onto that HTTP
 * status, and — the part that matters here — the CODE alone identifies the refusal. A plain
 * `P0001` is what ANY `raise exception` produces, including future checks on this table, and
 * answering 429 to an unrelated failure would tell a member to slow down when nothing was too
 * fast. Matching a code beats matching a message fragment, which is hostage to how the driver
 * decorates it.
 */
export const WAITLIST_RATE_LIMITED_CODE = 'PT429';

/**
 * Is this the waitlist throttle refusing, rather than something actually broken?
 *
 * The refusal arrives at the caller as an ordinary insert failure (issue #23), so without this
 * the route would answer 500 — telling a member the site is broken when it is telling them to
 * slow down.
 */
export function isWaitlistRateLimited(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  return (err as { code?: unknown }).code === WAITLIST_RATE_LIMITED_CODE;
}

/**
 * Add an email to the pre-launch waitlist (anon insert-only RLS). The unique
 * index makes a re-submit a no-op: a Postgres unique violation (23505) resolves
 * to `{ ok: true, duplicate: true }` rather than an error, so the caller can show
 * a friendly "already on the list" message. Plumbing only — no business logic.
 */
export async function subscribeToWaitlist(
  client: AthanorClient,
  input: WaitlistInsert,
): Promise<{ ok: true; duplicate: boolean }> {
  const payload = waitlistInsertSchema.parse(input);
  const { error } = await client.from('email_waitlist').insert(payload);
  if (error) {
    if (error.code === '23505') return { ok: true, duplicate: true };
    throw error;
  }
  return { ok: true, duplicate: false };
}
