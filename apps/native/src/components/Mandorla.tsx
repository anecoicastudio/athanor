import type { ReactNode } from 'react';
import Svg, { Path } from 'react-native-svg';
import { semantic } from '@athanor/config';
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
      /* `borderRadius` is here for the GLOW, not for clipping: nothing is clipped without
         `overflow: 'hidden'`, and the vesica is drawn by the SVG below. A CSS `boxShadow` is
         cast from the border box, so on a square View the halo came out square — which is what
         iOS showed the moment `auraGlow()` moved off `shadowRadius` (whose iOS implementation
         derived the shape from the layer's contents, i.e. the round avatar, and so looked
         right by accident). Rounding the box makes both platforms cast the round halo this
         always meant to have. Measured on the iPhone 17 Pro Max sim and the moto g17, #815. */
      style={[{ width: size, height: size, borderRadius: size / 2 }, auraGlow(glowLevel)]}
    >
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
          stroke={semantic.auraLine}
          strokeWidth={1.5}
        />
      </Svg>
      {children}
    </View>
  );
}
