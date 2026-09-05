import type { ComponentType } from 'react';
import type { ColorValue } from 'react-native';
import Svg, { Circle, Ellipse, Line, Path } from 'react-native-svg';
import { semantic } from '@athanor/config';
import type { ZodiacSign } from '@athanor/schemas';

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
// `ColorValue`, not `string`: react-navigation hands `tabBarIcon` a `ColorValue` since RN 0.86's
// types, and react-native-svg's `stroke` takes the same type, so nothing narrows in between.
export type GlyphProps = { size?: number; color?: ColorValue };

const VB = 24;

const line = (color?: ColorValue) => ({
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
const stroke = (color?: ColorValue) => ({
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

/**
 * The `eye` from the 20-glyph esoteric set (DESIGN §6), ported from the prototype's
 * `GLYPHS.eye` rather than drawn fresh — the set names it, so this is unported debt
 * (`glyphs.tsx` header above; `trust/notifTypes.ts` still stands in with a `◎` char)
 * being paid down, not a new mark. `line()`'s 1.8px, because §6 specifies 1.2–1.8 for
 * set glyphs; the 2px `stroke()` family above is a deliberate deviation for header icons.
 *
 * Two collisions the geometry has to survive, both settled by the lashes:
 * - The lid outline ALONE is a vesica, and §6 reserves the mandorla to the logo.
 * - `ProfiloGlyph` is a circle with an ellipse through it; an eye is an ellipse with a
 *   circle in it, and at 20px on the dark canvas the two would otherwise read alike.
 *
 * The iris stays UNFILLED — §6: "never filled except a center point", and this is not
 * the center point of a circumpunct.
 */
const EYE_LID = 'M3 12C7 7.5 17 7.5 21 12 17 16.5 7 16.5 3 12Z';
const EYE_LASH_LEFT = 'M9 15.9q-1.4 3-4 3.5';
const EYE_LASH_RIGHT = 'M13.7 15.6l1.1 3.2';

export function EyeGlyph({ size = 22, color }: GlyphProps) {
  const c = color ?? semantic.foregroundMuted;
  return (
    <Svg width={size} height={size} viewBox={`0 0 ${VB} ${VB}`}>
      <Path d={EYE_LID} {...line(c)} />
      <Circle cx={12} cy={12} r={2.3} {...line(c)} />
      <Path d={EYE_LASH_LEFT} {...line(c)} />
      <Path d={EYE_LASH_RIGHT} {...line(c)} />
    </Svg>
  );
}

/**
 * The struck eye — hidden. The set has no crossed variant, so the diagonal is new, but it
 * is the one stroke §6 allows ("designed in this same system"): a straight line, corner
 * to corner.
 *
 * ── WHY THIS ONE DROPS THE LASHES, AND WHY THE DIAGONAL RUNS THIS WAY ─────────────
 * Both were settled by rendering the candidates at the size that actually ships (20pt),
 * not at inspection size. A bottom-left-to-top-right diagonal runs straight through the
 * lower-left lash and the two merge into a smudge — at 20pt it was barely distinguishable
 * from the open eye, which is the one thing this glyph has to be. Top-left to bottom-right
 * clears the lashes, and dropping them as well is what makes the struck state read
 * decisively small: the pair then differs by a whole stroke group plus the diagonal
 * rather than by one line crossing a busy corner.
 *
 * So this is not `EyeGlyph` plus a line, deliberately. The SHAPE is the state, never the
 * colour — both variants render in the same token, per the app's paired-glyph vocabulary
 * (DESIGN §11, 2026-08-08, where a colour-only lit/unlit distinction was rejected) and G2.
 *
 * Dropping the lashes takes away what `EyeGlyph` above names as the settlement of the
 * vesica collision, so it has to be settled again here rather than assumed: the diagonal
 * does it. Rule 4 reserves the mandorla to the logo and `Mandorla.tsx` draws it today as
 * the avatar frame, but that mark is a VERTICAL almond in `auraLine` at avatar scale,
 * closed; this is a horizontal lens in `foregroundMuted` at 20pt whose silhouette the
 * corner-to-corner stroke breaks open. A closed lid alone would be the argument to have;
 * a struck one is not.
 */
export function EyeOffGlyph({ size = 22, color }: GlyphProps) {
  const c = color ?? semantic.foregroundMuted;
  return (
    <Svg width={size} height={size} viewBox={`0 0 ${VB} ${VB}`}>
      <Path d={EYE_LID} {...line(c)} />
      <Circle cx={12} cy={12} r={2.3} {...line(c)} />
      <Line x1={2.5} y1={2.5} x2={21.5} y2={21.5} {...line(c)} />
    </Svg>
  );
}

/**
 * Zodiac set (DESIGN.md §6 addendum, #694) — twelve glyphs in the same compass-and-ruler
 * system as the set above: stroke only, 1.8, round caps, at most three primitives each, no
 * fill. Register is cosmetic/granted like «Membro fondatore» — the default colour is `ink2`,
 * never `aura`, never a glow (rule #4): a sign is something you were born under, not
 * something that happened here. Keys are the twelve lowercase Italian `ZodiacSign` values, so
 * a sign the database can store always has a drawing (the Record makes that a type error).
 *
 * Rendered ONLY beside the display name in the profile header and in the funnel's reveal;
 * never on cards, chat, lists, or the OG card. No a11y props here — `ZodiacMark` wraps the
 * drawing and names it (`profile.zodiac.a11y`), the same split as `Avatar`.
 */
const zodiacSvg = (size: number, color: ColorValue | undefined, children: React.ReactNode) => (
  <Svg width={size} height={size} viewBox={`0 0 ${VB} ${VB}`}>
    {children}
  </Svg>
);

const z = (color?: ColorValue) => line(color ?? semantic.ink2);

export function ArieteGlyph({ size = 20, color }: GlyphProps) {
  // The ram: a stem with two horns curling outward from its top.
  return zodiacSvg(
    size,
    color,
    <>
      <Path d="M12 21V8" {...z(color)} />
      <Path d="M12 8c0-5-6-5-6 0" {...z(color)} />
      <Path d="M12 8c0-5 6-5 6 0" {...z(color)} />
    </>,
  );
}

export function ToroGlyph({ size = 20, color }: GlyphProps) {
  // The bull: a circle wearing a crescent of horns.
  return zodiacSvg(
    size,
    color,
    <>
      <Circle cx={12} cy={14} r={6} {...z(color)} />
      <Path d="M5 4c0 4 3 6 7 6s7-2 7-6" {...z(color)} />
    </>,
  );
}

export function GemelliGlyph({ size = 20, color }: GlyphProps) {
  // The twins: two uprights joined by a bowed bar top and bottom.
  return zodiacSvg(
    size,
    color,
    <>
      <Path d="M8 5v14M16 5v14" {...z(color)} />
      <Path d="M5 4c3 2 11 2 14 0" {...z(color)} />
      <Path d="M5 20c3-2 11-2 14 0" {...z(color)} />
    </>,
  );
}

export function CancroGlyph({ size = 20, color }: GlyphProps) {
  // The crab: two claws, each a point with a tail sweeping past the other.
  return zodiacSvg(
    size,
    color,
    <>
      <Circle cx={8.5} cy={9} r={2.5} {...z(color)} />
      <Circle cx={15.5} cy={15} r={2.5} {...z(color)} />
      <Path d="M6 9c0-5 8-6 12-2M18 15c0 5-8 6-12 2" {...z(color)} />
    </>,
  );
}

export function LeoneGlyph({ size = 20, color }: GlyphProps) {
  // The lion: a small circle and one mane-stroke that rises, loops and falls to a tail.
  return zodiacSvg(
    size,
    color,
    <>
      <Circle cx={7.5} cy={15.5} r={3} {...z(color)} />
      <Path d="M10.5 15.5C10.5 9 12 4 15 4c3 0 4 3 4 5 0 3-3 6-3 9 0 2 2 3 4 2" {...z(color)} />
    </>,
  );
}

export function VergineGlyph({ size = 20, color }: GlyphProps) {
  // The maiden: three arches, the last closing into a loop.
  return zodiacSvg(
    size,
    color,
    <>
      <Path d="M4 18V8c0-2 4-2 4 0v10M8 8c0-2 4-2 4 0v10" {...z(color)} />
      <Path d="M12 12c4 0 7 3 6 6c-1 2-4 2-6 0" {...z(color)} />
    </>,
  );
}

export function BilanciaGlyph({ size = 20, color }: GlyphProps) {
  // The scales: an omega over its base.
  return zodiacSvg(
    size,
    color,
    <>
      <Path d="M4 15h4a4 4 0 0 1 8 0h4" {...z(color)} />
      <Path d="M4 19h16" {...z(color)} />
    </>,
  );
}

export function ScorpioneGlyph({ size = 20, color }: GlyphProps) {
  // The scorpion: the maiden's arches, the last one ending in a barbed tail.
  return zodiacSvg(
    size,
    color,
    <>
      <Path d="M4 18V8c0-2 4-2 4 0v10M8 8c0-2 4-2 4 0v10" {...z(color)} />
      <Path d="M12 8v8c0 2 2 3 4 2" {...z(color)} />
      <Path d="M15 15l2 3-3 1" {...z(color)} />
    </>,
  );
}

export function SagittarioGlyph({ size = 20, color }: GlyphProps) {
  // The archer: an arrow on the diagonal, head up-right, fletched.
  return zodiacSvg(
    size,
    color,
    <>
      <Path d="M5 19L19 5" {...z(color)} />
      <Path d="M12 5h7v7" {...z(color)} />
      <Path d="M8 12l4 4" {...z(color)} />
    </>,
  );
}

export function CapricornoGlyph({ size = 20, color }: GlyphProps) {
  // The sea-goat: two arches, then a circle hooked to the second.
  return zodiacSvg(
    size,
    color,
    <>
      <Path d="M4 7c1-2 3-2 4 0v9M8 7c1-2 3-2 4 0v7" {...z(color)} />
      <Circle cx={16} cy={15} r={3.5} {...z(color)} />
      <Path d="M12.5 14c0-4 3-5 6-3" {...z(color)} />
    </>,
  );
}

export function AcquarioGlyph({ size = 20, color }: GlyphProps) {
  // The water-bearer: two zigzags (not waves — the 20-set already owns `waves`).
  return zodiacSvg(
    size,
    color,
    <>
      <Path d="M3 9l3-3 3 3 3-3 3 3 3-3 3 3" {...z(color)} />
      <Path d="M3 16l3-3 3 3 3-3 3 3 3-3 3 3" {...z(color)} />
    </>,
  );
}

export function PesciGlyph({ size = 20, color }: GlyphProps) {
  // The fishes: two arcs facing away, tied by a bar.
  return zodiacSvg(
    size,
    color,
    <>
      <Path d="M7 4c-4 4-4 12 0 16" {...z(color)} />
      <Path d="M17 4c4 4 4 12 0 16" {...z(color)} />
      <Path d="M4 12h16" {...z(color)} />
    </>,
  );
}

/** Every storable sign has a drawing — a missing key here is a type error, not a blank. */
export const ZODIAC_GLYPHS: Record<ZodiacSign, ComponentType<GlyphProps>> = {
  ariete: ArieteGlyph,
  toro: ToroGlyph,
  gemelli: GemelliGlyph,
  cancro: CancroGlyph,
  leone: LeoneGlyph,
  vergine: VergineGlyph,
  bilancia: BilanciaGlyph,
  scorpione: ScorpioneGlyph,
  sagittario: SagittarioGlyph,
  capricorno: CapricornoGlyph,
  acquario: AcquarioGlyph,
  pesci: PesciGlyph,
};

export function ZodiacGlyph({ sign, size = 20, color }: GlyphProps & { sign: ZodiacSign }) {
  const Glyph = ZODIAC_GLYPHS[sign];
  return <Glyph size={size} color={color} />;
}
