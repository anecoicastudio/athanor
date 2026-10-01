import { claimableHandleSchema, handleSchema } from '@athanor/schemas';

/**
 * What typed text says about itself as an @handle (#782). `empty` is nothing typed yet, never an
 * error; `malformed` is the shape the column CHECK refuses (3–30, a–z 0–9 _); `reserved` is a word
 * `profiles_handle_not_reserved` refuses (#430). Whether a claimable handle is already someone's
 * is the database's to say — the caller asks it.
 */
export type HandleVerdict = 'empty' | 'malformed' | 'reserved' | 'claimable';

/**
 * The typed text as a handle candidate: leading whitespace dropped, one leading `@` dropped
 * (people type it out of habit), lowercased because the column holds lowercase only. Nothing
 * else is repaired: a space or a dot stays, so `classifyHandle` can say it is not allowed instead
 * of the field quietly turning the name into something the person did not type.
 *
 * The START only, never the end: the field is controlled, so this runs on every keystroke's
 * prefix, and trimming the end ate a typed space before the next letter arrived — `lucia ferri`
 * became `luciaferri`, a free handle nobody typed (caught in review on #782).
 */
export function normalizeHandleInput(raw: string): string {
  const trimmed = raw.trimStart();
  return (trimmed.startsWith('@') ? trimmed.slice(1) : trimmed).toLowerCase();
}

/**
 * Classify a candidate handle. The shape is checked before the reserved list, so a candidate that
 * breaks both is named for its shape — the rule a person can act on.
 */
export function classifyHandle(candidate: string): HandleVerdict {
  if (candidate.length === 0) return 'empty';
  if (!handleSchema.safeParse(candidate).success) return 'malformed';
  return claimableHandleSchema.safeParse(candidate).success ? 'claimable' : 'reserved';
}

/** The column's upper bound (`handleSchema`). A cut made here is still judged by `classifyHandle`. */
const HANDLE_MAX_LENGTH = 30;

/**
 * Latin letters with no canonical decomposition: NFD leaves them whole, so stripping marks does
 * not reach them and they would otherwise separate words («Søren» → `s_ren`). Lowercase only —
 * the fold runs after `toLowerCase()`.
 */
const LATIN_FOLDS: readonly (readonly [string, string])[] = [
  ['ß', 'ss'],
  ['æ', 'ae'],
  ['œ', 'oe'],
  ['ø', 'o'],
  ['ł', 'l'],
  ['đ', 'd'],
  ['ð', 'd'],
  ['þ', 'th'],
  ['ı', 'i'],
];

/**
 * Handles to OFFER for a name the person already gave — Apple's, Google's, or the sign-up form's
 * (#908, Marco's ruling 2026-10-01). Most specific first: `elena_rossi`, `elenarossi`, `elena_r`,
 * `elena`. The caller asks the database which is free and offers the first that is; the person
 * can still type anything else.
 *
 * Never from an email: that half of #782 stands, so a «name» carrying an `@` yields nothing — a
 * provider can hand back an address where a name belongs, and its local part is exactly what the
 * ruling keeps off the public page.
 *
 * Diacritics fold to their base letter (`Niccolò` → `niccolo`, `Søren` → `soren`); anything
 * else outside a–z 0–9 separates words. Every candidate returned is `claimable` as it stands, so a name that reduces
 * to nothing, to a reserved word, or to under three characters gives fewer candidates or none —
 * never a guess.
 */
export function suggestHandles(displayName: string | null | undefined): string[] {
  if (!displayName || displayName.includes('@')) return [];
  const base = displayName.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
  const words = LATIN_FOLDS.reduce((text, [letter, fold]) => text.replaceAll(letter, fold), base)
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 0);
  const first = words[0];
  if (first === undefined) return [];

  const shapes = [words.join('_'), words.join('')];
  if (words.length > 1) shapes.push(`${first}_${words.slice(-1).join('').charAt(0)}`);
  shapes.push(first);

  // Words are joined by ONE underscore, so a cut can leave at most one behind.
  const candidates = shapes
    .map((shape) => shape.slice(0, HANDLE_MAX_LENGTH).replace(/_$/, ''))
    .filter((candidate) => classifyHandle(candidate) === 'claimable');
  return [...new Set(candidates)];
}
