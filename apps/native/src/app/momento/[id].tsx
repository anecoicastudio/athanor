import { useEffect } from 'react';
import { useRouter } from 'expo-router';
import { LoadingScreen } from '@/components/LoadingScreen';
import { useAuth } from '@/lib/auth-context';

/**
 * `/momento/{id}` deep-link catcher (#544). The AASA route and the Android intent filters
 * claim the prefix (ruled at the #159 close-out: claim every prefix now, ship the screens by
 * OTA), so an installed app intercepts the link — this route decides where it lands.
 *
 * A redirect to the Momenti tab, deliberately NOT a per-id viewer, because a Momento is not a
 * shareable surface in the family of `/event/*` and `/post/*`:
 *
 * - `momento_proposals_select_own` resolves a proposal for exactly one person, its recipient,
 *   and the only read path is the parameterless `get_momenti_deck` RPC — today's ≤3 pending
 *   cards. A per-id read would need a new RPC and a migration, to render something the deck
 *   already shows.
 * - Proposals expire daily; a URL to one outlives the row it names.
 * - Nothing mints `/momento/{id}` links yet — no web page (`apps/web` has no momento route),
 *   no share affordance. The claim is prophylactic.
 *
 * So the deck IS the viewer: the recipient's pending Momenti live on `(tabs)/momenti`, and
 * anyone else's link has nothing it may show. The `id` segment is accepted and dropped.
 * Signed-out mirrors `[handle]`: hand off to the entry flow, no stash — re-open after
 * sign-in (P4.1 funnel parity).
 */
export default function MomentoCatchScreen() {
  const { session, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    router.replace(session ? '/momenti' : '/(auth)/welcome');
  }, [loading, session, router]);

  return <LoadingScreen />;
}
