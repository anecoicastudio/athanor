import type { ReactNode } from 'react';
import Svg, { Path } from 'react-native-svg';
import { galleria } from '@athanor/config';
import { View } from '@/tw';

/**
 * Mandorla (vesica piscis) frame around something — an avatar, a ✦: the vertical lens is two
 * arcs meeting at the top and bottom points, and the child sits centred inside (DESIGN §5).
 * A hairline in the secondary grey. It glowed with the Aura tier until 2026-10-04; nothing on
 * mobile glows (rule 4), so `glowLevel` left with the shadow.
 */
export function Mandorla({ size, children }: { size: number; children: ReactNode }) {
  return (
    <View className="items-center justify-center" style={{ width: size, height: size }}>
      <Svg
        width={size}
        height={size}
        viewBox="0 0 100 100"
        style={{ position: 'absolute' }}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        {/* Vertical vesica: top point (50,4) → bottom (50,96), one arc per side.
            Verify on device the lens is symmetric; flip a sweep flag if a side inverts. */}
        <Path
          d="M50,4 A49,49 0 0,1 50,96 A49,49 0 0,1 50,4 Z"
          fill="none"
          stroke={galleria.foregroundMuted}
          strokeWidth={1.5}
        />
      </Svg>
      {children}
    </View>
  );
}
