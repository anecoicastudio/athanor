import { useEffect, useState } from 'react';

/**
 * The current instant, pinned at mount — or refreshed on an interval, when one is asked for.
 *
 * `Date.now()` during render makes a component non-idempotent — two renders of the same props
 * give different output — which is what `react-hooks/purity` rejects, and why the React Compiler
 * skipped every screen that read the clock inline (#691). Three screens already worked the rule
 * around with `useRef(Date.now()).current`: same pinned instant, but a ref read during render, so
 * it traded one diagnostic for two.
 *
 * **Pinned is the default, and it is a per-MOUNT guarantee, not a per-navigation one.** Every
 * pinned caller is a pushed or modal screen, which mounts fresh each time it is opened, and one
 * instant per screen is exactly what makes every «2 ore fa» in a list agree with the others —
 * what the two fund screens wanted the ref for. A lapsed sanction or a closed ballot window
 * therefore still clears on the next screen, with no timer.
 *
 * A **bottom tab does not remount** — expo-router's vendored bottom-tabs keeps a visited tab
 * mounted (`(tabs)/momenti.tsx` says so for its own latch) — so a tab that reads the clock for a
 * live/expired decision would hold its first instant for the whole session. Those callers pass an
 * interval and get a ticking value instead: `(tabs)/community.tsx` for story expiry, and
 * `home/DreamHeroCard.tsx` for the days remaining beside its own 60s refetch. A surface that has
 * to tick every second owns its own interval (`CountdownGrid`).
 */
export function useNow(intervalMs?: number): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!intervalMs) return;
    // In the callback, never in the effect body: this is a subscription to the clock, which is
    // the shape `react-hooks/set-state-in-effect` asks for.
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);

  return now;
}
