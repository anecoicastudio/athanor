/** Derive an @handle suggestion from an email. Rules: ^[a-z0-9_]{3,30}$ (schemas.handleSchema). */
export function suggestHandle(email: string): string {
  // `?? ''` is required by `noUncheckedIndexedAccess` but unreachable: split always returns at
  // least one element, so [0] is never undefined. Hence the one NoCoverage mutant here — an
  // equivalent mutant in the same sense, on a branch no input can enter.
  const local = email.split('@')[0] ?? '';
  let handle = local
    .toLowerCase()
    // The `+` here is redundant with the collapse on the next line (dropping it just produces
    // more underscores for that pass to merge) — an equivalent mutant, not a coverage hole.
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
  if (handle.length === 0) return 'aura';
  while (handle.length < 3) handle += '_';
  return handle.slice(0, 30);
}
