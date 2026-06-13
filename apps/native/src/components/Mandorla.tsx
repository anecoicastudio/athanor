import type { ReactNode } from 'react';
import Svg, { Path } from 'react-native-svg';
import { semantic } from '@auria/config';
import { View } from '@/tw';
import { auraGlow } from '@/lib/glow';

/**
 * Mandorla (vesica piscis) frame around the avatar — the brand's mandorla mark
 * applied as an avatar surround (DESIGN.md §6.2). The vertical lens is two arcs
 * meeting at the top/bottom points; the avatar sits centred inside; the cyan
 * glow scales with the read-only Aura tier.
 */
export function Mandorla({
  size,
  glowLevel,
  children,
}: {
  size: number;
  glowLevel: number;
  children: ReactNode;
}) {
  return (
    <View
      className="items-center justify-center"
      style={[{ width: size, height: size }, auraGlow(glowLevel)]}
    >
      <Svg width={size} height={size} viewBox="0 0 100 100" style={{ position: 'absolute' }}>
        {/* Vertical vesica: top point (50,4) → bottom (50,96), one arc per side.
            Verify on device the lens is symmetric; flip a sweep flag if a side inverts. */}
        <Path
          d="M50,4 A49,49 0 0,1 50,96 A49,49 0 0,1 50,4 Z"
          fill="none"
          stroke={semantic.auraLine}
          strokeWidth={1.5}
        />
      </Svg>
      {children}
    </View>
  );
}
