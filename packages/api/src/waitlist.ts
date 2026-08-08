import { type WaitlistInsert, waitlistInsertSchema } from '@athanor/schemas';
import type { AthanorClient } from './client';
import type { Database } from './database.types';

type AdminListWaitlistReturns = Database['public']['Functions']['admin_list_waitlist']['Returns'];

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

/**
 * A waitlist row as returned to admins (no id — export/display only). Tied to the
 * generated `admin_list_waitlist` return shape, but `source` is corrected to
 * nullable (the column is nullable; the SQL function's return type doesn't carry
 * that, so gen:types infers it as non-null).
 */
export type WaitlistAdminRow = Omit<AdminListWaitlistReturns[number], 'source'> & {
  source: string | null;
};

/**
 * Admin-only count of waitlist signups (the "how many are interested" number).
 * Calls the SECURITY DEFINER `admin_waitlist_count` RPC, which re-checks
 * is_admin() server-side and raises 42501 for non-admins.
 */
export async function getWaitlistCount(client: AthanorClient): Promise<number> {
  const { data, error } = await client.rpc('admin_waitlist_count');
  if (error) throw error;
  return data ?? 0;
}

/** Admin-only list of waitlist rows, newest first (consumed by /admin/waitlist in apps/web). */
export async function getWaitlistRows(
  client: AthanorClient,
  limit = 5000,
): Promise<WaitlistAdminRow[]> {
  const { data, error } = await client.rpc('admin_list_waitlist', { p_limit: limit });
  if (error) throw error;
  return data ?? [];
}
