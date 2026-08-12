/**
 * The buckets whose uploads get the server-side EXIF/GPS/metadata strip.
 *
 * Its own module, not a const inside index.ts, because index.ts calls `Deno.serve` at module
 * load — importing it from a test would start a server. buckets.test.ts needs to read this list
 * and compare it against the database trigger that feeds it.
 *
 * THIS LIST AND THE `media_process_enqueue` WHEN CLAUSE ARE ONE INVARIANT. They were split
 * across a migration and a TypeScript file, and they drifted the first time a bucket was added:
 * 20260811072211 extended the trigger to `avatars` and this set was left at four, so every
 * avatar upload fired a pg_net round trip that answered 400 and no face photo was ever
 * stripped. A bucket the trigger enqueues but this set rejects is worse than one it never
 * enqueued, because the enqueue looks like it is working.
 */
export const BUCKETS = new Set([
  'post-media',
  'moments',
  'story-segments',
  'candidacy-videos',
  'avatars',
]);
