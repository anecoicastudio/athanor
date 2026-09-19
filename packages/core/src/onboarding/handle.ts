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
