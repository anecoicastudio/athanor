import { z } from 'zod';

/**
 * Account password policy — the single source of truth for the rule the app
 * shows and the rule Supabase enforces. It must stay in step with
 * `minimum_password_length = 8` + `password_requirements =
 * "lower_upper_letters_digits"` (supabase/config.toml, and the same two settings
 * on the hosted project's dashboard). If they drift, the UI promises something
 * the server rejects and the user sees a `weak_password` error with a green form.
 *
 * The character classes are deliberately ASCII: GoTrue tests membership against
 * the literal `a-z` / `A-Z` / `0-9` sets, so a password whose only uppercase is
 * `È` passes a unicode-aware check here and is refused server-side.
 *
 * Sign-UP only. Sign-in must NOT re-validate — accounts created before this
 * policy still hold passwords that fail it, and gating their login on the new
 * rule would lock out real people.
 */
export const PASSWORD_MIN_LENGTH = 8;

export type PasswordRequirement = 'length' | 'lowercase' | 'uppercase' | 'digit';

/** The one table. `passwordSchema` and the UI checklist both read from it. */
const REQUIREMENTS: ReadonlyArray<{
  id: PasswordRequirement;
  met: (value: string) => boolean;
}> = [
  { id: 'length', met: (v) => v.length >= PASSWORD_MIN_LENGTH },
  { id: 'lowercase', met: (v) => /[a-z]/.test(v) },
  { id: 'uppercase', met: (v) => /[A-Z]/.test(v) },
  { id: 'digit', met: (v) => /[0-9]/.test(v) },
];

/** Every requirement, in display order — drives the checklist under the field. */
export const PASSWORD_REQUIREMENTS: readonly PasswordRequirement[] = REQUIREMENTS.map((r) => r.id);

/** The rules `value` still fails, in display order. Empty means acceptable. */
export function unmetPasswordRequirements(value: string): PasswordRequirement[] {
  return REQUIREMENTS.filter((r) => !r.met(value)).map((r) => r.id);
}

/**
 * Same verdict as `unmetPasswordRequirements`, as a Zod boundary. It delegates
 * rather than re-listing the rules, so the two can never disagree. Each unmet
 * requirement surfaces as its own issue, with the id in `message` for callers
 * that want to map it to a translated line.
 */
export const passwordSchema = z.string().superRefine((value, ctx) => {
  for (const requirement of unmetPasswordRequirements(value)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: requirement });
  }
});
