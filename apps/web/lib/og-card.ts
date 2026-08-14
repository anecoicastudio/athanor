/**
 * Pure layout helpers for the per-handle OG card (#157) — kept out of
 * app/[handle]/opengraph-image.tsx so they stay unit-testable (the route module
 * imports next/og, which vitest has no reason to load).
 */

/**
 * Quote type size by dream length. dreamTextSchema allows 1–500 chars; the steps
 * keep a short dream display-grade and the 500-char maximum inside the 1200×630
 * frame with the 72px padding (~8 lines at 34px / 1.25 line-height).
 */
export function quoteFontSize(length: number): number {
  if (length <= 90) return 64;
  if (length <= 160) return 56;
  if (length <= 260) return 46;
  if (length <= 380) return 40;
  return 34;
}

/**
 * Avatar-fallback initial, same precedence as the Avatar component spec
 * (DESIGN.md §9): the name when set, the handle when not. Unicode-safe — a
 * name starting with an astral-plane character yields the whole character,
 * not half a surrogate pair.
 */
export function cardInitial(displayName: string | null, handle: string): string {
  const source = displayName?.trim() || handle;
  return (Array.from(source)[0] ?? '').toUpperCase();
}
