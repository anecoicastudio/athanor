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
export type StoryRailProfile = { handle: string | null } | { handle: string | null }[] | null;

/** One fetched story_segments row, narrowed to the columns the rail derives from. */
export type StoryRailRow = {
  author_id: string;
  created_at: string;
  profiles: StoryRailProfile;
};

/** One rail entry: a person with ≥1 unexpired segment, plus their most recent activity time. */
export type StoryRailPerson = { author_id: string; handle: string | null; latest_at: string };

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
      latest_at: row.created_at,
    });
    if (rail.length >= limit) break;
  }
  return rail;
}
