import { type WaitlistInsert, waitlistInsertSchema } from '@athanor/schemas';
import type { AthanorClient } from './client';

export const waitlistKeys = {
  all: ['waitlist'] as const,
};

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
