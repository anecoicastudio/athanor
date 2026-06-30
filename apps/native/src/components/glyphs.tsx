import Svg, { Circle, Ellipse, Line, Path } from 'react-native-svg';
import { semantic } from '@athanor/config';

/**
 * Tab-bar esoteric glyphs (DESIGN.md §6 / §8) — sacred-geometry, stroke-only,
 * `currentColor`, ~1.6–1.8px, round caps, never filled except a center point.
 * One glyph per actual tab (the app uses Costellazioni as a tab where the spec
 * sketch listed Live — Live is a modal here). The full 20-glyph content set
 * (marketplace thumbnails, feature cards) remains Foundation debt.
 *
 * Shape vocabulary:
 *   Home          → circumpunct        (the centre, the self)
 *   Community     → triad              (three, the people)
 *   Momenti       → kairos spark       (the instant — ✦)
 *   Costellazioni → constellation      (joined stars, the projects)
 *   Profilo       → sphere of meridians (the self that evolves)
 */
type GlyphProps = { size?: number; color?: string };

const VB = 24;

const line = (color?: string) => ({
  stroke: color ?? semantic.foregroundMuted,
  strokeWidth: 1.8,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  fill: 'none' as const,
});

export function HomeGlyph({ size = 24, color }: GlyphProps) {
  const c = color ?? semantic.foregroundMuted;
  return (
    <Svg width={size} height={size} viewBox={`0 0 ${VB} ${VB}`}>
      <Circle cx={12} cy={12} r={8} {...line(c)} />
      <Circle cx={12} cy={12} r={1.8} fill={c} />
    </Svg>
  );
}

export function CommunityGlyph({ size = 24, color }: GlyphProps) {
  return (
    <Svg width={size} height={size} viewBox={`0 0 ${VB} ${VB}`}>
      <Circle cx={12} cy={6.5} r={3.2} {...line(color)} />
      <Circle cx={6.5} cy={16} r={3.2} {...line(color)} />
      <Circle cx={17.5} cy={16} r={3.2} {...line(color)} />
    </Svg>
  );
}

export function MomentiGlyph({ size = 24, color }: GlyphProps) {
  // Four-point concave star (Kairos ✦) — curves drawn toward the centre.
  return (
    <Svg width={size} height={size} viewBox={`0 0 ${VB} ${VB}`}>
      <Path d="M12 3 Q13 11 21 12 Q13 13 12 21 Q11 13 3 12 Q11 11 12 3 Z" {...line(color)} />
    </Svg>
  );
}

export function CostellazioniGlyph({ size = 24, color }: GlyphProps) {
  const c = color ?? semantic.foregroundMuted;
  return (
    <Svg width={size} height={size} viewBox={`0 0 ${VB} ${VB}`}>
      {/* joining lines */}
      <Path d="M5 8 L12 5 L18 11 L11 18 Z" {...line(c)} />
      {/* stars (small filled points) */}
      <Circle cx={5} cy={8} r={1.5} fill={c} />
      <Circle cx={12} cy={5} r={1.5} fill={c} />
      <Circle cx={18} cy={11} r={1.5} fill={c} />
      <Circle cx={11} cy={18} r={1.5} fill={c} />
    </Svg>
  );
}

export function ProfiloGlyph({ size = 24, color }: GlyphProps) {
  return (
    <Svg width={size} height={size} viewBox={`0 0 ${VB} ${VB}`}>
      <Circle cx={12} cy={12} r={8} {...line(color)} />
      <Ellipse cx={12} cy={12} rx={3.2} ry={8} {...line(color)} />
      <Line x1={4} y1={12} x2={20} y2={12} {...line(color)} />
    </Svg>
  );
}
