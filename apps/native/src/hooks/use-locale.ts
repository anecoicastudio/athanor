import type { Locale } from '@athanor/schemas';
import { useAuth } from '@/lib/auth-context';
import { deviceLocale } from '@/lib/locale';

/**
 * The locale every signed-in screen renders in: the member's stored `profile.locale`,
 * falling back to the DEVICE language when there isn't one (#331).
 *
 * The fallback is the ruling, not an implementation detail. A member with no stored locale
 * — a profile row that predates the onboarding picker (#158), or one still hydrating —
 * follows their device rather than a hardcoded 'it'. Fifty screens used to hardcode it and
 * the tab bar did not; this is the tab bar's behaviour, everywhere.
 *
 * Free: `profile` is already in AuthContext, populated by the session hydration. This is a
 * context read, NOT a query — do not reach for `useProfile`, which resolves SOMEONE ELSE's
 * profile by id and would cost a round trip to answer a question about the viewer.
 *
 * Pre-auth screens have no profile at all: the funnel uses `deviceLocale` directly and the
 * screens after it use `useDraftLocale`, which prefers the draft's picked locale.
 */
export function useLocale(): Locale {
  const { profile } = useAuth();
  return profile?.locale ?? deviceLocale;
}
