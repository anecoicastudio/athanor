// apps/native/src/lib/a11y.ts
import { useEffect } from 'react';
import { AccessibilityInfo } from 'react-native';
import { spoken } from './star';

/**
 * Announce a sheet/overlay headline on open so screen readers don't lose context (A-5).
 *
 * The dependency is `text`, not `[]`, so it also fires when the sentence CHANGES in place — a
 * live verdict, a transient pill — which is why the check-in scanner and the Momenti deck toast
 * use it without remounting (#635). Pass `undefined` while there is nothing to say; going
 * `undefined` and back re-announces, which is what a repeated verdict needs.
 *
 * On iOS this is the ONLY way a transient message reaches VoiceOver: `accessibilityLiveRegion`
 * is Android-only, so a pill that carries it and nothing else is silent on the platform this app
 * ships to testers on.
 */
export function useAnnounceOnMount(text: string | undefined): void {
  useEffect(() => {
    if (text) AccessibilityInfo.announceForAccessibility(spoken(text));
  }, [text]);
}

/** Expands a sub-44pt visual target to a ≥44pt touch target (A-1). ~11pt each side around a 22pt icon. */
export const HIT_SLOP = { top: 11, bottom: 11, left: 11, right: 11 } as const;

/** Spread onto a modal/overlay root to trap screen-reader focus inside it (iOS, A-5). */
export const MODAL_A11Y = { accessibilityViewIsModal: true } as const;
