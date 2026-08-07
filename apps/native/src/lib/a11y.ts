// apps/native/src/lib/a11y.ts
import { useEffect } from 'react';
import { AccessibilityInfo } from 'react-native';

/** Announce a sheet/overlay headline on open so screen readers don't lose context (A-5). */
export function useAnnounceOnMount(text: string | undefined): void {
  useEffect(() => {
    if (text) AccessibilityInfo.announceForAccessibility(text);
  }, [text]);
}

/** Expands a sub-44pt visual target to a ≥44pt touch target (A-1). ~11pt each side around a 22pt icon. */
export const HIT_SLOP = { top: 11, bottom: 11, left: 11, right: 11 } as const;

/** Spread onto a modal/overlay root to trap screen-reader focus inside it (iOS, A-5). */
export const MODAL_A11Y = { accessibilityViewIsModal: true } as const;
