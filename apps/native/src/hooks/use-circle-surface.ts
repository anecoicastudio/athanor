import { Platform } from 'react-native';
import { type CircleSurface, circleSurface } from '@/lib/circle-surface';
import { useCircleCheckoutGate } from '@/hooks/use-remote-config';

export type { CircleSurface };

/**
 * `circleSurface` (#761) wired to the live checkout flag and this device's platform. `member` is
 * whatever the calling surface counts as unlocked — a feature flag for `CircleGate`, `isMember`
 * for the Settings row. The flag read shares `useCircleCheckoutGate`'s query key, so a list of
 * event rows costs one request, not one per row.
 */
export function useCircleSurface(member: boolean): CircleSurface {
  const checkout = useCircleCheckoutGate();
  return circleSurface({ member, os: Platform.OS, checkout });
}
