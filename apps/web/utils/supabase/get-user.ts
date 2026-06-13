import type { User } from '@supabase/supabase-js';

let warned = false;

/**
 * getUser() that degrades to logged-out when Supabase is unreachable (e.g. the
 * local stack isn't running) instead of throwing. Rule 8 still holds — this
 * wraps getUser(), never getSession(). Warns once per process, not per request.
 */
export async function getUserSafe(supabase: {
  auth: { getUser: () => Promise<{ data: { user: User | null } }> };
}): Promise<User | null> {
  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    return user;
  } catch {
    if (!warned) {
      warned = true;
      console.warn(
        '[auth] Supabase unreachable — run `supabase start`. Treating requests as logged-out.',
      );
    }
    return null;
  }
}
