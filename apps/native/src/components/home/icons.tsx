import Svg, { Path, Circle, Line } from 'react-native-svg';
import { semantic } from '@auria/config';

/**
 * Minimal line-icon subset for the Home header (search / messages / notifiche).
 * Stroke geometry, 24-unit viewBox, like the prototype's inline SVGs. The full
 * 20-glyph esoteric set (DESIGN.md §6.2) is still Foundation debt — only the
 * three the header needs are built here.
 */
type IconProps = { size?: number; color?: string };

const stroke = (color?: string) => ({
  stroke: color ?? semantic.foregroundMuted,
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  fill: 'none' as const,
});

export function SearchIcon({ size = 22, color }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Circle cx={11} cy={11} r={7} {...stroke(color)} />
      <Line x1={21} y1={21} x2={16.65} y2={16.65} {...stroke(color)} />
    </Svg>
  );
}

export function MessageIcon({ size = 22, color }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path
        d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"
        {...stroke(color)}
      />
    </Svg>
  );
}

export function BellIcon({ size = 22, color }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" {...stroke(color)} />
      <Path d="M13.73 21a2 2 0 0 1-3.46 0" {...stroke(color)} />
    </Svg>
  );
}
