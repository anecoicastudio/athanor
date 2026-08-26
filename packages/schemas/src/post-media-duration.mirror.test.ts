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
 * One bound on a post clip, written down in FOUR languages (#56, widened by #154):
 * `MEDIA_LIMITS.MAX_CLIP_SECONDS` in `@athanor/core`, the `.max()` in this package, the
 * `post_media_duration_s_check` CHECK in SQL, and the catalog sentences that say the number
 * out loud to a member in IT and EN. `packages/schemas/src/password.mirror.test.ts`
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
 * `MEDIA_LIMITS.MAX_CLIP_SECONDS` as packages/core spells it.
 *
 * `matchAll` and a count, not `match`: without the `g` flag `.match()` returns the FIRST hit,
 * so a second `MAX_CLIP_SECONDS:` appearing anywhere above the real one would be read in its
 * place — quietly, and quite possibly with the value this test wants to see. Anchored to the
 * start of a line so prose in a docblock cannot be mistaken for the declaration, and required
 * to be unique so any other arrangement fails loudly instead of guessing.
 *
 * It read `MAX_VIDEO_SECONDS` until #154 renamed it. The rename had to land in the same commit
 * as this line for exactly the reason the `found.length !== 1` throw exists: a regex pinned to
 * a name that no longer occurs does not go quietly green, it throws — which is the failure
 * direction a mirror test owes its reader.
 */
function coreMaxClipSeconds(): number {
  const limits = join(ROOT, 'packages', 'core', 'src', 'media', 'limits.ts');
  if (!existsSync(limits)) throw new Error(`packages/core media limits not found at ${limits}`);
  const found = [...readFileSync(limits, 'utf8').matchAll(/^\s*MAX_CLIP_SECONDS:\s*(\d+)\s*,/gm)];
  if (found.length !== 1) {
    throw new Error(
      `expected exactly one MAX_CLIP_SECONDS literal in core media limits, found ${found.length}`,
    );
  }
  return Number(found[0]![1]);
}

/**
 * The catalog sentences that spell the cap in prose, in both languages.
 *
 * The fourth copy, and the only one a MEMBER ever reads. `media.tooLong` refuses an over-cap
 * pick («Il video può durare al massimo 60 secondi.») and the two sheet rows advertise the cap
 * before the member spends a minute talking into a phone. A number in prose drifts exactly the
 * way #56's CHECK drifted, and nothing had ever pinned these: the constant, the schema and the
 * SQL could all move together and the app would go on telling people 60.
 *
 * Keyed by name rather than swept by pattern on purpose. A sweep for "any catalog value with a
 * number in it" would pin unrelated copy and go red on a price or a count; this list is the
 * claim, and a key that stops existing fails rather than silently dropping out of the scan.
 */
const CAP_IN_PROSE = ['media.tooLong', 'media.sheet.video', 'media.sheet.audio'] as const;

function catalog(locale: 'it' | 'en'): Record<string, string> {
  const path = join(ROOT, 'packages', 'i18n', 'src', 'catalogs', `${locale}.json`);
  if (!existsSync(path)) throw new Error(`catalog not found at ${path}`);
  return JSON.parse(readFileSync(path, 'utf8')) as Record<string, string>;
}

describe('the post clip cap is one number in four places', () => {
  it('the post_media CHECK is POST_MEDIA_MAX_DURATION_SECONDS', () => {
    expect(currentDatabaseBound()).toBe(POST_MEDIA_MAX_DURATION_SECONDS);
  });

  it('MEDIA_LIMITS.MAX_CLIP_SECONDS is POST_MEDIA_MAX_DURATION_SECONDS', () => {
    // The client-side cap. If this drifts up, a capture door accepts a clip the CHECK then
    // refuses — an upload that finishes and a row that never lands.
    expect(coreMaxClipSeconds()).toBe(POST_MEDIA_MAX_DURATION_SECONDS);
  });

  it('is 60, and not merely three copies of whatever it became', () => {
    // The literal is asserted once, here. Without it all three could move together and this
    // file would stay green while the product decision (#56) was quietly reversed.
    expect(POST_MEDIA_MAX_DURATION_SECONDS).toBe(60);
  });

  it('binds an audio row, because the CHECK has no kind predicate (#154)', () => {
    // The bound was only ever asserted against `kind: 'video'` — here and in
    // supabase/tests/0012_post_media_rls.test.sql — because until #154 no surface could
    // produce an audio row at all. It could always have written one: `duration_s` is a single
    // column and `post_media_duration_s_check` carries no `kind` predicate. Now that the
    // recorder exists, the kind that goes UNASSERTED is the kind that drifts, so audio is
    // named here rather than left to inherit the claim.
    const insert = { post_id: '00000000-0000-0000-0000-000000000002', position: 0 };
    const cap = POST_MEDIA_MAX_DURATION_SECONDS;
    const audio = { ...insert, kind: 'audio', storage_path: 'uid/post/0.m4a' };
    expect(postMediaInsertSchema.parse({ ...audio, duration_s: cap }).duration_s).toBe(cap);
    expect(() => postMediaInsertSchema.parse({ ...audio, duration_s: cap + 1 })).toThrow();
  });

  it('is the number both catalogs say out loud, in IT and in EN (#154)', () => {
    // The copy is the fourth place the cap is written, and the only one a member reads. Three
    // constants agreeing while the sentence says something else is a lie told in two
    // languages — and it is the cheapest of the four to leave behind, because no compiler and
    // no CHECK ever looks at a string.
    const cap = String(POST_MEDIA_MAX_DURATION_SECONDS);
    for (const locale of ['it', 'en'] as const) {
      const messages = catalog(locale);
      for (const key of CAP_IN_PROSE) {
        const value = messages[key];
        expect(value, `${locale}.json has no ${key}`).toBeDefined();
        expect(value, `${locale}.json ${key} does not say ${cap}: ${value}`).toContain(cap);
      }
    }
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
