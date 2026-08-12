/**
 * How a member is named in the UI (#76).
 *
 * `@handle` is the identity and always exists; `display_name` is optional and enriches it. So the
 * rule is one line — show the name they chose, and the handle when they chose none — and it lives
 * here rather than at fifteen render sites, because fifteen copies is how «@stella_p» and
 * «Stella» end up labelling the same person on two adjacent screens.
 *
 * Returns `null` when a row carries neither. That is not a defensive nicety: a `profiles` embed is
 * RLS-nulled when a block is raised between the write and the read, and the caller has to decide
 * what to draw there. A placeholder would be copy, and copy belongs in `@athanor/i18n`.
 */
export function memberLabel(
  displayName: string | null | undefined,
  handle: string | null | undefined,
): string | null {
  const name = displayName?.trim();
  if (name) return name;
  return handle ? `@${handle}` : null;
}
