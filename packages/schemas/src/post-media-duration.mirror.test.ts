import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  POST_MEDIA_MAX_DURATION_SECONDS,
  postMediaInsertSchema,
  postMediaSchema,
} from './post-media';

/**
 * One bound on a post clip, written down in three languages (#56): `MEDIA_LIMITS.
 * MAX_VIDEO_SECONDS` in `@athanor/core`, the `.max()` in this package, and the
 * `post_media_duration_s_check` CHECK in SQL. `packages/schemas/src/password.mirror.test.ts`
 * closes the same class of claim for the auth config, and `reserved-handles.mirror.test.ts`
 * for a list the database enforces.
 *
 * This issue IS the drift it guards against: core said 60 from M3, the picker enforced 60 on
 * every path, and `post_media` shipped a CHECK of 1200 for two months with every test green —
 * because `moments` and `story_segments` got the number and this one table did not. The gap
 * was reachable only by a client that is not our app, which is exactly the kind nothing but a
 * constraint and a test can see.
 *
 * Core cannot simply be imported: `@athanor/core` imports `@athanor/schemas`, so the edge only
 * runs one way and an import here would close a cycle. Its source is read as text instead —
 * `packages/schemas/turbo.json` declares that file as a `$TURBO_ROOT$` test input so the cache
 * invalidates when it changes.
 */
/**
 * Found by walking UP from this file, not by counting `../`: Stryker runs the suite from a
 * sandbox copy of the package (`.stryker-tmp/sandbox-N/`), two levels deeper than the package
 * sits in the repo, where a fixed relative path resolves to `packages/schemas/supabase/
 * migrations` and kills the dry run. (`reserved-handles.mirror.test.ts`,
 * `audit-log-actions.mirror.test.ts` and `affinity.mirror.test.ts` carry the same note.)
 */
const ROOT = (() => {
  let dir = fileURLToPath(new URL('.', import.meta.url).href);
  for (;;) {
    if (existsSync(join(dir, 'supabase', 'migrations'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) throw new Error('no supabase/migrations directory above this test');
    dir = parent;
  }
})();

/**
 * The upper bound `post_media.duration_s` carries in a single migration, or undefined if that
 * migration does not declare one.
 *
 * Two shapes, because a CHECK cannot be edited in place: the column declares it inline when
 * the table is created, and every later change drops the constraint and re-adds it by name.
 * The inline read is scoped to the `create table public.post_media` block on purpose —
 * `moments` and `story_segments` spell the identical predicate, so an unscoped match would
 * happily pin the wrong table's bound.
 */
function declaredBound(sql: string): number | undefined {
  const named = sql.match(
    /add constraint post_media_duration_s_check\s+check \(duration_s is null or duration_s between 0 and (\d+)\)/,
  );
  if (named?.[1] !== undefined) return Number(named[1]);
  const createBlock = sql.match(/create table public\.post_media \(([\s\S]*?)\n\);/)?.[1];
  const inline = createBlock?.match(
    /duration_s\s+int\s+check \(duration_s is null or duration_s between 0 and (\d+)\)/,
  );
  return inline?.[1] === undefined ? undefined : Number(inline[1]);
}

/** The bound in force: the LAST migration to declare one, since migrations are append-only. */
function currentDatabaseBound(): number {
  const migrations = join(ROOT, 'supabase', 'migrations');
  const bounds = readdirSync(migrations)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((f) => declaredBound(readFileSync(join(migrations, f), 'utf8')))
    .filter((bound): bound is number => bound !== undefined);
  const last = bounds.at(-1);
  if (last === undefined) throw new Error('no migration declares post_media.duration_s bounds');
  return last;
}

/**
 * `MEDIA_LIMITS.MAX_VIDEO_SECONDS` as packages/core spells it.
 *
 * `matchAll` and a count, not `match`: without the `g` flag `.match()` returns the FIRST hit,
 * so a second `MAX_VIDEO_SECONDS:` appearing anywhere above the real one would be read in its
 * place — quietly, and quite possibly with the value this test wants to see. Anchored to the
 * start of a line so prose in a docblock cannot be mistaken for the declaration, and required
 * to be unique so any other arrangement fails loudly instead of guessing.
 */
function coreMaxVideoSeconds(): number {
  const limits = join(ROOT, 'packages', 'core', 'src', 'media', 'limits.ts');
  if (!existsSync(limits)) throw new Error(`packages/core media limits not found at ${limits}`);
  const found = [...readFileSync(limits, 'utf8').matchAll(/^\s*MAX_VIDEO_SECONDS:\s*(\d+)\s*,/gm)];
  if (found.length !== 1) {
    throw new Error(
      `expected exactly one MAX_VIDEO_SECONDS literal in core media limits, found ${found.length}`,
    );
  }
  return Number(found[0]![1]);
}

describe('the post clip cap is one number in three places', () => {
  it('the post_media CHECK is POST_MEDIA_MAX_DURATION_SECONDS', () => {
    expect(currentDatabaseBound()).toBe(POST_MEDIA_MAX_DURATION_SECONDS);
  });

  it('MEDIA_LIMITS.MAX_VIDEO_SECONDS is POST_MEDIA_MAX_DURATION_SECONDS', () => {
    // The client-side cap. If this drifts up, the picker accepts a clip the CHECK then
    // refuses — an upload that finishes and a row that never lands.
    expect(coreMaxVideoSeconds()).toBe(POST_MEDIA_MAX_DURATION_SECONDS);
  });

  it('is 60, and not merely three copies of whatever it became', () => {
    // The literal is asserted once, here. Without it all three could move together and this
    // file would stay green while the product decision (#56) was quietly reversed.
    expect(POST_MEDIA_MAX_DURATION_SECONDS).toBe(60);
  });

  it('is the bound both schemas actually enforce, not just a constant beside them', () => {
    // A constant nothing reads is a comment. The insert re-declares duration_s rather than
    // picking it, so both are named.
    const row = {
      id: '00000000-0000-0000-0000-000000000001',
      post_id: '00000000-0000-0000-0000-000000000002',
      kind: 'video',
      storage_path: 'uid/post/0.mp4',
      thumb_path: null,
      width: 1920,
      height: 1080,
      position: 0,
      created_at: '2026-06-14T00:00:00.000Z',
      updated_at: '2026-06-14T00:00:00.000Z',
    };
    const insert = {
      post_id: row.post_id,
      kind: 'video',
      storage_path: row.storage_path,
      position: 0,
    };
    const cap = POST_MEDIA_MAX_DURATION_SECONDS;
    expect(postMediaSchema.parse({ ...row, duration_s: cap }).duration_s).toBe(cap);
    expect(postMediaInsertSchema.parse({ ...insert, duration_s: cap }).duration_s).toBe(cap);
    expect(() => postMediaSchema.parse({ ...row, duration_s: cap + 1 })).toThrow();
    expect(() => postMediaInsertSchema.parse({ ...insert, duration_s: cap + 1 })).toThrow();
  });
});
