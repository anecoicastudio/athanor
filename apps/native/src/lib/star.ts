import type { Star, StarKey } from '@athanor/schemas';
import { AURA_UNKNOWN } from './aura-display';

/**
 * The app's star vocabulary: ✦ lit / ✧ unlit / — unknown (DESIGN §11, 2026-08-08 + 2026-08-09).
 *
 * SHAPE carries the state, not colour. `faint` was retuned for AA and stopped reading clearly
 * "off" against `aura`, and rule #3 doesn't want an assertive unlit star anyway — so the states
 * must differ by glyph, and every surface that shows a star must agree on which is which.
 *
 * It lives in one place because it didn't, and it drifted: `FeedPost`'s card star kept a filled
 * ✦ through the change that introduced ✧, claiming "you lit this" on every post in the feed.
 * `unknown` is here for the same reason — it is the Aura placeholder by construction, so a
 * change to the app's unknown mark must move the star vocabulary with it rather than silently
 * splitting the two apart.
 *
 * NOT for the other pairs that happen to share ✦ — ✦/○ (post-compose step flag), ✦/◇ (trust,
 * verify), ✦/◓ (VideoUploadTile). Those are different vocabularies; folding them in here would
 * invent a meaning they don't have.
 */
export const STAR = { lit: '✦', unlit: '✧', unknown: AURA_UNKNOWN } as const;

export type StarCellState = keyof typeof STAR;

/**
 * The SPOKEN form of a member-facing string: the same sentence with the ✦/✧ ornament removed
 * (#635).
 *
 * A rendered glyph can be marked decorative — `accessibilityElementsHidden` plus the Android
 * sibling, which ~25 sites do. An IMPERATIVE announcement has no element to mark:
 * `AccessibilityInfo.announceForAccessibility` speaks whatever is in the string, and dozens of catalog
 * values carry a spark as pure ornament («Invito inviato ✦», «Voto spostato ✦»). VoiceOver reads
 * it as "white four pointed star" or drops it, and neither is the sentence.
 *
 * It lives HERE, next to `STAR`, because this module is where the app decides what the marks
 * mean: a vocabulary and the rule for taking it out of speech belong together, and this module
 * is pure, so it is reachable by the `environment: 'node'` harness that `ToastHost.tsx` is not.
 * Deliberately narrow — it strips the two spark glyphs and the double space that removing one
 * leaves behind, and NOT «—», «›» or «·», which are either content (the Aura placeholder) or
 * already inside strings a screen reader handles.
 */
export function spoken(label: string): string {
  return label
    .replace(/[✦✧]/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/** The glyph for a star's binary state. Callers still choose the colour (`aura` / `faint`). */
export function star(lit: boolean): string {
  return lit ? STAR.lit : STAR.unlit;
}

/** The glyph for any of the three states — the form to reach for once `unknown` is possible. */
export function starGlyph(state: StarCellState): string {
  return STAR[state];
}

/** The star rows a surface needs to decide a cell's state. `Star` carries more; this is the part. */
type StarRow = Pick<Star, 'starId' | 'grantedAt'>;

/**
 * Which of THREE states a star cell is in — the decision, in one place, so no surface that
 * renders a star can disagree about it (issue #16).
 *
 * `stars === null` means the read failed or has not landed. It is not the same as `[]`, and
 * the difference is the whole point: an empty array is a real answer (this member has earned
 * none of the six), while a failed read is no answer at all. Coalescing the second into the
 * first — `starsQuery.data ?? []` — rendered six dark stars on the strength of a network blip,
 * which on an earned-only reputation (PRD §1.1) claims the member has done nothing. Same
 * false-confidence bug as the Aura zero in `aura-display.ts`, wearing a different hat, and its
 * sibling: with the number beside it now reading «—» honestly, a confident dark grid was
 * getting MORE credible, not less.
 *
 * `unknown` is a third SHAPE, not a third colour. DESIGN §11 (2026-08-08) settled that the
 * paired glyphs carry state — ✦ lit, ✧ unlit — and explicitly rejected a new `inert` token for
 * splitting `faint`, so a dimmed ✧ would be exactly the colour-only distinction that decision
 * forbids. `key` is `StarKey`, not `string`, so a typo cannot silently resolve to `'unlit'` —
 * which would be the same false «unearned» claim this function exists to prevent.
 */
export function starCellState(stars: StarRow[] | null, key: StarKey): StarCellState {
  if (stars == null) return 'unknown';
  return stars.find((s) => s.starId === key)?.grantedAt != null ? 'lit' : 'unlit';
}

/**
 * What the whole Sei Stelle block renders — the viewer asymmetry, extracted so the branch that
 * could leak is assertable. It is the most consequential decision in issue #16 and it otherwise
 * lived only in `SixStarsGrid.tsx`, which this app's `environment: 'node'` vitest harness cannot
 * reach (`*.test.ts` glob; the 176 `.tsx` files are structurally uncollectable).
 *
 * - `'grid'` — six cells, each resolved by `starCellState`. Always for the owner; for anyone
 *   else it shows only their earned stars, since rule #3 hides what a member is missing.
 * - `'unavailable'` — a single placeholder, and ONLY for a failed read of someone else. Six
 *   unknown cells there would render more cells than a real profile with two lit stars, turning
 *   the viewer's own network failure into a visible shape difference — a claim about a person
 *   made out of the reader's connection. One line states the viewer's failure and asserts
 *   nothing about the member, and stays distinguishable from a genuinely starless member, whose
 *   grid renders no cells at all.
 */
export function starsBlockMode(
  stars: StarRow[] | null,
  viewerIsOwner: boolean,
): 'grid' | 'unavailable' {
  return stars == null && !viewerIsOwner ? 'unavailable' : 'grid';
}
