import { z } from 'zod';

/**
 * The twelve sun signs, in the order of `profiles_zodiac_sign_check`
 * (20260905165133). Lowercase Italian keys, like `tag.identity.*`: IT is the canonical
 * catalog, and the key is what the DB stores, what `zodiac.<key>` labels, and what
 * `ZODIAC_GLYPHS` is indexed by. `zodiac.mirror.test.ts` pins this list against the CHECK.
 *
 * Which sign a date falls in is NOT decided here: the cusp table has one home in
 * `athanor.zodiac_sign(date)` and a mirror in `@athanor/core` (`zodiacSignFromBirthDate`).
 */
export const ZODIAC_SIGNS = [
  'ariete',
  'toro',
  'gemelli',
  'cancro',
  'leone',
  'vergine',
  'bilancia',
  'scorpione',
  'sagittario',
  'capricorno',
  'acquario',
  'pesci',
] as const;
export const zodiacSignSchema = z.enum(ZODIAC_SIGNS);
export type ZodiacSign = z.infer<typeof zodiacSignSchema>;

/**
 * A calendar day as PostgREST serialises a `date` column: `YYYY-MM-DD`, nothing else. The
 * funnel writes it in the same shape (local parts, no timezone — a birthday has none).
 * `z.string().date()` refuses impossible days (2023-02-29) as well as malformed text.
 */
export const birthDateSchema = z.string().date();
export type BirthDate = z.infer<typeof birthDateSchema>;
