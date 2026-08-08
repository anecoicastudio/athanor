/**
 * WCAG contrast arithmetic over the Athanor tokens.
 *
 * This exists because of a real bug. `tokens.ts` certifies `faint` at "~4.69 on raise2", and a
 * change trusted that number for a `Tag` pill — but that pill renders INSIDE a `bg-raise` row,
 * and `raise`/`raise2` are translucent, so the real backdrop was raise2 over raise over the
 * canvas, where `faint` is 4.22:1 — under the AA floor. A certified ratio names a SURFACE, not
 * a token, and nothing here could check that. Now it can.
 *
 * Pure and dependency-free, so it runs in the app's existing node vitest. Same shape as
 * `lib/glow.ts`: style math that reads `@athanor/config` rather than literal hex.
 *
 * Belongs in `packages/config` beside the tokens it certifies; it lives here because that
 * package has no test runner (scripts: `typecheck` only). Move it if that ever changes.
 */

/** WCAG AA floor for normal-size text (<18.66px regular / <24px bold). */
export const AA_NORMAL = 4.5;
/** WCAG AA floor for large text, and the 1.4.11 floor for non-text UI. */
export const AA_LARGE = 3;

type Rgb = { r: number; g: number; b: number };

/** `#RGB` / `#RRGGBB` → channels. */
function parseHex(hex: string): Rgb {
  const h = hex.replace('#', '').trim();
  const full =
    h.length === 3
      ? h
          .split('')
          .map((c) => c + c)
          .join('')
      : h;
  if (full.length !== 6) throw new Error(`contrast: not a hex color: ${hex}`);
  return {
    r: parseInt(full.slice(0, 2), 16),
    g: parseInt(full.slice(2, 4), 16),
    b: parseInt(full.slice(4, 6), 16),
  };
}

/** `rgba(r,g,b,a)` / `rgb(r,g,b)` → channels + alpha. */
function parseRgba(color: string): Rgb & { a: number } {
  const inner = color.match(/rgba?\(([^)]+)\)/i)?.[1];
  if (inner === undefined) throw new Error(`contrast: not an rgb(a) color: ${color}`);
  const parts = inner.split(',').map((p) => Number(p.trim()));
  const [r, g, b, a] = parts;
  if (r === undefined || g === undefined || b === undefined || parts.some(Number.isNaN)) {
    throw new Error(`contrast: malformed rgb(a) color: ${color}`);
  }
  return { r, g, b, a: a ?? 1 };
}

function toHex({ r, g, b }: Rgb): string {
  const c = (n: number) =>
    Math.round(Math.min(255, Math.max(0, n)))
      .toString(16)
      .padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}

/**
 * Source-over composite: a translucent `rgba(…)` layer painted on an OPAQUE hex backdrop,
 * returned as hex so results chain — `over(raise2, over(raise, background))`.
 *
 * This is the function whose absence caused the bug. A token's ratio depends on the whole
 * stack beneath it, so surfaces must be composed in render order, outermost backdrop last.
 */
export function over(layer: string, backdrop: string): string {
  const l = parseRgba(layer);
  const b = parseHex(backdrop);
  return toHex({
    r: l.a * l.r + (1 - l.a) * b.r,
    g: l.a * l.g + (1 - l.a) * b.g,
    b: l.a * l.b + (1 - l.a) * b.b,
  });
}

/** WCAG 2.1 relative luminance of an opaque hex color. */
export function luminance(hex: string): number {
  const { r, g, b } = parseHex(hex);
  const lin = (channel: number) => {
    const c = channel / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** WCAG contrast ratio between two OPAQUE colors. Order-independent; 1…21. */
export function ratio(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}
