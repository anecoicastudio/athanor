/**
 * The app's star vocabulary: ✦ lit / ✧ unlit (DESIGN §11, 2026-08-08).
 *
 * SHAPE carries the state, not colour. `faint` was retuned for AA and stopped reading clearly
 * "off" against `aura`, and rule #3 doesn't want an assertive unlit star anyway — so the two
 * states must differ by glyph, and every surface that shows a star must agree on which is which.
 *
 * It lives in one place because it didn't, and it drifted: `FeedPost`'s card star kept a filled
 * ✦ through the change that introduced ✧, claiming "you lit this" on every post in the feed.
 *
 * NOT for the other pairs that happen to share ✦ — ✦/○ (post-compose step flag), ✦/◇ (trust,
 * verify), ✦/◓ (VideoUploadTile). Those are different vocabularies; folding them in here would
 * invent a meaning they don't have.
 */
export const STAR = { lit: '✦', unlit: '✧' } as const;

/** The glyph for a star's state. Callers still choose the colour (`aura` lit / `faint` unlit). */
export function star(lit: boolean): string {
  return lit ? STAR.lit : STAR.unlit;
}
