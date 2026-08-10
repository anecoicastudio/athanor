import type { User } from '@supabase/supabase-js';

/**
 * Whether a signed-in user may reach /admin.
 *
 * Extracted so the rule stays tested. It used to live inline in the deleted
 * proxy/middleware pair, whose test carried the assertions; the dashboard layout is
 * now the only gate in front of the panel, so the rule needs a home of its own.
 *
 * `app_metadata` ONLY — never `user_metadata`, which is writable by the user
 * themselves and would make admin self-grantable (supabase rules; the same reason
 * the DB gates on is_admin()).
 */
export function isAdmin(user: User | null | undefined): boolean {
  return (user?.app_metadata as { role?: string } | undefined)?.role === 'admin';
}
