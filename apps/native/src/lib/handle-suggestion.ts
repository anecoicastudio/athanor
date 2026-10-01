/**
 * The first of `candidates` nobody holds, or `null` (#908, Marco's ruling 2026-10-01).
 *
 * `suggestHandles` (@athanor/core) proposes shapes from the name the person already gave; this
 * asks the database about them ONE AT A TIME and in order, so the most specific free shape wins
 * and a name whose first shape is free costs a single read. A lookup that fails ends the walk
 * with nothing: the suggestion is what the person accepts with one tap, so it is only ever a
 * handle known to be free. The field is still theirs to type in, and the unique index is still
 * the gate.
 */
export async function firstFreeHandle(
  candidates: readonly string[],
  isTaken: (handle: string) => Promise<boolean>,
): Promise<string | null> {
  for (const candidate of candidates) {
    try {
      if (!(await isTaken(candidate))) return candidate;
    } catch {
      return null;
    }
  }
  return null;
}
