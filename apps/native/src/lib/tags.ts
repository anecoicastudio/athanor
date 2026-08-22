/**
 * Add or remove one tag from a selection list.
 *
 * Extracted from two byte-identical copies — `(onboarding)/index.tsx` and
 * `components/profile/ProfileEditForm.tsx` — which is not a coincidence: onboarding
 * asks the identity/seeking questions and the profile editor is where the answers are
 * revised, so they are the same picker twice.
 *
 * Both copies took the state setter as an argument (`toggle(list, set, tag)`); this
 * returns the next list instead, which is what makes it testable at a boundary — the
 * call site keeps its own `setIdentity(...)`.
 */
export function toggleTag(list: string[], tag: string): string[] {
  return list.includes(tag) ? list.filter((x) => x !== tag) : [...list, tag];
}
