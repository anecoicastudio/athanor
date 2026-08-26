import Svg, { Circle, Ellipse, Line, Path } from 'react-native-svg';
import { semantic } from '@athanor/config';

// The single home for the app's SVG icon set: tab-bar esoteric glyphs (below)
// plus the header line icons (bottom). Unicode-glyph stand-ins elsewhere
// (trust/notifTypes.ts) remain Foundation debt.

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
 *   Momenti       → the ✦ spark        (the instant)
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
  // Four-point concave star (the ✦ spark) — curves drawn toward the centre.
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

/**
 * Header line icons (search / messages / notifiche) — heavier 2px stroke and
 * 22px default, matching the prototype's inline SVGs (deliberately weightier
 * than the 1.8px tab glyphs). Formerly components/home/icons.tsx.
 */
const stroke = (color?: string) => ({
  stroke: color ?? semantic.foregroundMuted,
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  fill: 'none' as const,
});

export function SearchIcon({ size = 22, color }: GlyphProps) {
  return (
    <Svg width={size} height={size} viewBox={`0 0 ${VB} ${VB}`}>
      <Circle cx={11} cy={11} r={7} {...stroke(color)} />
      <Line x1={21} y1={21} x2={16.65} y2={16.65} {...stroke(color)} />
    </Svg>
  );
}

export function MessageIcon({ size = 22, color }: GlyphProps) {
  return (
    <Svg width={size} height={size} viewBox={`0 0 ${VB} ${VB}`}>
      <Path
        d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"
        {...stroke(color)}
      />
    </Svg>
  );
}

export function BellIcon({ size = 22, color }: GlyphProps) {
  return (
    <Svg width={size} height={size} viewBox={`0 0 ${VB} ${VB}`}>
      <Path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" {...stroke(color)} />
      <Path d="M13.73 21a2 2 0 0 1-3.46 0" {...stroke(color)} />
    </Svg>
  );
}

export function SettingsIcon({ size = 22, color }: GlyphProps) {
  // Sun-wheel: circumpunct + eight radial ticks — the icon system's gear
  // (compass-and-ruler geometry per DESIGN §6, replacing a U+2699 text char
  // that fell back to the emoji font). Same 2px header stroke as above.
  const c = color ?? semantic.foregroundMuted;
  const ticks = Array.from({ length: 8 }, (_, i) => {
    const a = (i * Math.PI) / 4;
    return {
      x1: 12 + 7.4 * Math.cos(a),
      y1: 12 + 7.4 * Math.sin(a),
      x2: 12 + 10 * Math.cos(a),
      y2: 12 + 10 * Math.sin(a),
    };
  });
  return (
    <Svg width={size} height={size} viewBox={`0 0 ${VB} ${VB}`}>
      <Circle cx={12} cy={12} r={5.6} {...stroke(c)} />
      <Circle cx={12} cy={12} r={1.5} fill={c} />
      {ticks.map((p, i) => (
        <Line key={i} x1={p.x1} y1={p.y1} x2={p.x2} y2={p.y2} {...stroke(c)} />
      ))}
    </Svg>
  );
}
