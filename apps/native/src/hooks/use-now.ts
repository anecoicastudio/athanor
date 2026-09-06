import { useState } from 'react';

/**
 * The instant this component mounted, pinned for its lifetime.
 *
 * `Date.now()` during render makes a component non-idempotent — two renders of the same props
 * give different output — which is what `react-hooks/purity` rejects, and why the React Compiler
 * skipped every screen that read the clock inline (#691). Three screens already worked the rule
 * around with `useRef(Date.now()).current`: same pinned instant, but a ref read during render, so
 * it traded one diagnostic for two.
 *
 * Pinned rather than ticking, on purpose. Everything reading it is a relative timestamp
 * («2 ore fa»), an expiry check, or a countdown's starting point — and one instant per screen is
 * exactly what makes every «2 ore fa» in a list agree with the others, which is what the two
 * fund screens wanted the ref for. A surface that must re-evaluate as time passes owns its own
 * interval (`CountdownGrid`); and `Screen` mounts its children per navigation, so a lapsed
 * sanction or a closed ballot window still clears on the next screen, with no timer anywhere.
 */
export function useNow(): number {
  const [now] = useState(() => Date.now());
  return now;
}
