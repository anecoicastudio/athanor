/**
 * Story-rail derivation. Pure: no I/O, no clock — `@athanor/api` fetches the window of
 * live segments and hands the rows here (api rule: that package is plumbing, the logic
 * lives in core).
 */

/**
 * The embedded profile as PostgREST hands it back: an object when it infers a to-one
 * relationship, a one-element array when it infers to-many, and null when the join found
 * nothing. All three reach the client, so all three are part of the contract.
 */
export type StoryRailEmbeddedProfile = {
  handle: string | null;
  display_name: string | null;
  avatar_path: string | null;
};

export type StoryRailProfile = StoryRailEmbeddedProfile | StoryRailEmbeddedProfile[] | null;

/** One fetched story_segments row, narrowed to the columns the rail derives from. */
export type StoryRailRow = {
  author_id: string;
  created_at: string;
  profiles: StoryRailProfile;
};

/** One rail entry: a person with ≥1 unexpired segment, plus their most recent activity time. */
export type StoryRailPerson = {
  author_id: string;
  handle: string | null;
  /** Optional name and avatar key (#76) — null for a member who set neither, which is a first-class state. */
  display_name: string | null;
  avatar_path: string | null;
  latest_at: string;
};

/**
 * Collapse a newest-first window of segments into at most `limit` PEOPLE: first row per
 * author wins (so `latest_at` is that author's most recent activity), row order is
 * preserved, and the embedded profile shape is normalised to a plain handle.
 *
 * The caller's ordering is authoritative — this never re-sorts, so a differently ordered
 * window yields a differently ordered rail rather than a silently "corrected" one.
 */
export function buildStoryRail(rows: readonly StoryRailRow[], limit: number): StoryRailPerson[] {
  const rail: StoryRailPerson[] = [];
  if (limit <= 0) return rail;

  const seen = new Set<string>();
  for (const row of rows) {
    if (seen.has(row.author_id)) continue;
    seen.add(row.author_id);
    const embedded = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles;
    rail.push({
      author_id: row.author_id,
      handle: embedded?.handle ?? null,
      display_name: embedded?.display_name ?? null,
      avatar_path: embedded?.avatar_path ?? null,
      latest_at: row.created_at,
    });
    if (rail.length >= limit) break;
  }
  return rail;
}

/**
 * Order a rail into a play session (#298): the tapped person first, then the unseen people in
 * rail order, then the seen people in rail order — seen people go to the back but still play,
 * never skipped. The entry plays first regardless of its own seen state (the member asked for
 * it). An entry no longer in the rail (a refetch race) degrades to unseen-then-seen.
 */
export function buildStorySession<P extends { author_id: string }>(
  rail: readonly P[],
  entryAuthorId: string,
  seenIds: ReadonlySet<string>,
): P[] {
  const entry = rail.find((p) => p.author_id === entryAuthorId);
  const rest = rail.filter((p) => p.author_id !== entryAuthorId);
  const unseen = rest.filter((p) => !seenIds.has(p.author_id));
  const seen = rest.filter((p) => seenIds.has(p.author_id));
  return entry ? [entry, ...unseen, ...seen] : [...unseen, ...seen];
}
