import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { POST_MEDIA_MAX_COUNT, postMediaPublishSchema, postMediaSchema } from './post-media.ts';

/**
 * How many media rows one post may carry, written down in THREE languages (#591):
 * `MEDIA_LIMITS.MAX_POST_MEDIA` in `@athanor/core`, `POST_MEDIA_MAX_COUNT` and the `.max()` it
 * feeds in this package, and the pair of SQL objects that actually refuse the eleventh row.
 * `post-media-duration.mirror.test.ts` closes the same class of claim for the clip length and
 * is the shape this file follows.
 *
 * Three and not four: no catalog sentence says the number out loud. The composer disables the
 * attach button at ten rather than explaining itself, so unlike the duration cap there is no
 * member-facing prose to drift. If copy ever states it, this file grows the arm the sibling
 * already has.
 *
 * The drift it guards against is the one #591 filed: the cap was a property of ONE screen.
 * `MEDIA_LIMITS.MAX_POST_MEDIA` was read at three sites, all of them in post-compose, and
 * neither `publish_post` nor `post_media` bounded anything — so a member calling
 * `/rest/v1/rpc/publish_post` or `POST /rest/v1/post_media` directly could attach a media set
 * of any size to their own post. Moving the cap into SQL makes it a migration-gated product
 * constant: the number changes with a migration or not at all, and this test is what says so
 * when someone edits only one copy.
 *
 * Core cannot simply be imported — `@athanor/core` imports `@athanor/schemas`, so an import
 * here would close a cycle. Its source is read as text instead; `packages/schemas/turbo.json`
 * already declares that file and `supabase/migrations/*.sql` as `$TURBO_ROOT$` test inputs, so
 * the cache invalidates when either moves.
 */
/**
 * Found by walking UP from this file, not by counting `../`: Stryker runs the suite from a
 * sandbox copy of the package (`.stryker-tmp/sandbox-N/`), two levels deeper than the package
 * sits in the repo, where a fixed relative path resolves to `packages/schemas/supabase/
 * migrations` and kills the dry run. (`post-media-duration.mirror.test.ts`,
 * `reserved-handles.mirror.test.ts` and `affinity.mirror.test.ts` carry the same note.)
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
 * Every migration in apply order, each paired with its SQL stripped of `--` comments and
 * collapsed onto one line per statement.
 *
 * Both matter. Comments have to go FIRST, or a statement search reads the prose above a
 * statement as part of it — and these migrations carry long headers that discuss the very
 * objects the arms below look for, so an unstripped search would match this file's own
 * rationale and go red on a change nobody made. Collapsing whitespace afterwards is what lets
 * a statement written across several lines (`drop index if exists\n  public.…;`) be seen at
 * all.
 */
function migrations(): { name: string; sql: string; statements: string[] }[] {
  const dir = join(ROOT, 'supabase', 'migrations');
  return readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((name) => {
      const sql = readFileSync(join(dir, name), 'utf8');
      const bare = sql
        .split('\n')
        .map((line) => line.replace(/--.*$/, ''))
        .join('\n');
      const statements = bare
        .split(';')
        .map((s) => s.replace(/\s+/g, ' ').trim())
        .filter((s) => s.length > 0);
      return { name, sql: bare, statements };
    });
}

/**
 * The predicate bodies of every `post_media.position` CHECK a migration declares, in the order
 * the file declares them, with `"` stripped so the quoted and bare spellings read alike.
 *
 * Two spellings, because a CHECK cannot be edited in place: `create table public.post_media`
 * declares it inline as an anonymous column check, and every later change drops the
 * auto-generated `post_media_position_check` and re-adds it by that name. The inline read is
 * scoped to the create block, because `moments` and `story_segments` also carry a `position`
 * and an unscoped match would pin the wrong table's bound.
 *
 * `"position"` is stripped rather than matched, since the create block writes `position` bare
 * and the #591 migration writes it quoted (`position` is a col_name keyword). Matching only the
 * quoted form is the documented mirror trap: it reads as stricter and silently sees less.
 */
function declaredPredicates(sql: string): string[] {
  const found: string[] = [];
  const createBlock = sql.match(/create table public\.post_media \(([\s\S]*?)\n\);/)?.[1];
  const inline = createBlock?.match(/\n\s*"?position"?\s+int[^\n]*?\bcheck \(([^)]*)\)/);
  if (inline?.[1] !== undefined) found.push(inline[1]);
  for (const m of sql.matchAll(
    /add constraint post_media_position_check\s+check \(([\s\S]*?)\);/g,
  )) {
    found.push(m[1]!);
  }
  return found.map((p) => p.replaceAll('"', '').replace(/\s+/g, ' ').trim());
}

/**
 * The number of media rows one post may hold, given the predicate in force.
 *
 * It COUNTS THE ADMISSIBLE POSITIONS rather than lifting the literal, because the literal is
 * not the cap. `post_media_post_position` is UNIQUE on (post_id, position), so the cap is
 * however many values `position` may take: `>= 0 and < 10` is ten rows, and `>= 0 and <= 10` is
 * ELEVEN while still reading "10" to anyone grepping for the number. A test that pinned the
 * literal would stay green through exactly that edit.
 *
 * Returns undefined for a predicate that bounds `position` below only — which is what the
 * `create table` block declares, and what a migration removing the cap would declare again.
 */
function capFromPredicate(predicate: string): number | undefined {
  const between = predicate.match(/^position between (\d+) and (\d+)$/);
  if (between) return Number(between[2]) - Number(between[1]) + 1;
  const range = predicate.match(/^position >= (\d+) and position (<=?) (\d+)$/);
  if (!range) return undefined;
  const low = Number(range[1]);
  const high = Number(range[3]);
  return range[2] === '<' ? high - low : high - low + 1;
}

/**
 * The cap in force: read from the LAST predicate any migration declares, since migrations are
 * append-only and each re-declaration replaces the one before it.
 *
 * The NEWEST declaration, not the newest one this file happens to understand. Those differ, and
 * the difference is the whole failure mode: taking the last predicate that PARSES means a later
 * migration dropping the upper bound — or writing it in a shape not handled above — falls back
 * to the previous cap and every arm below stays green while the database enforces nothing. So
 * an unparseable newest predicate throws, loudly, naming the migration that wrote it.
 */
function currentDatabaseCap(): number {
  const declarations = migrations().flatMap(({ name, sql }) =>
    declaredPredicates(sql).map((predicate) => ({ name, predicate })),
  );
  const newest = declarations.at(-1);
  if (newest === undefined) {
    throw new Error('no migration declares a CHECK on post_media.position');
  }
  const cap = capFromPredicate(newest.predicate);
  if (cap === undefined) {
    throw new Error(
      `${newest.name} declares post_media.position as \`${newest.predicate}\`, which bounds no ` +
        'row cap — either the cap was dropped, or it was written in a shape this test cannot read',
    );
  }
  return cap;
}

/**
 * `MEDIA_LIMITS.MAX_POST_MEDIA` as packages/core spells it.
 *
 * `matchAll` and a count, not `match`: without the `g` flag `.match()` returns the FIRST hit,
 * so a second `MAX_POST_MEDIA:` anywhere above the real one would be read in its place —
 * quietly, and quite possibly with the value this test wants to see. Anchored to the start of a
 * line so prose in a docblock cannot be mistaken for the declaration, and required to be unique
 * so any other arrangement fails loudly instead of guessing.
 */
function coreMaxPostMedia(): number {
  const limits = join(ROOT, 'packages', 'core', 'src', 'media', 'limits.ts');
  if (!existsSync(limits)) throw new Error(`packages/core media limits not found at ${limits}`);
  const found = [...readFileSync(limits, 'utf8').matchAll(/^\s*MAX_POST_MEDIA:\s*(\d+)\s*,/gm)];
  if (found.length !== 1) {
    throw new Error(
      `expected exactly one MAX_POST_MEDIA literal in core media limits, found ${found.length}`,
    );
  }
  return Number(found[0]![1]);
}

describe('the post media-set cap is one number in three places', () => {
  it('the positions post_media admits are POST_MEDIA_MAX_COUNT', () => {
    // If the schema drifts UP, a boundary parse accepts a row the database then refuses; if SQL
    // drifts up, the cap silently stops being the cap.
    expect(currentDatabaseCap()).toBe(POST_MEDIA_MAX_COUNT);
  });

  it('MEDIA_LIMITS.MAX_POST_MEDIA is POST_MEDIA_MAX_COUNT', () => {
    // The client-side cap. If this drifts up, the composer accepts an attachment the CHECK then
    // refuses — an upload that finishes and a publish that raises on a card already assembled.
    expect(coreMaxPostMedia()).toBe(POST_MEDIA_MAX_COUNT);
  });

  it('is 10, and not merely three copies of whatever it became', () => {
    // The literal is asserted once, here. Without it all three could move together and this
    // file would stay green while the product decision was quietly reversed.
    expect(POST_MEDIA_MAX_COUNT).toBe(10);
  });

  it('is the bound both schemas actually enforce, not just a constant beside them', () => {
    // A constant nothing reads is a comment. `postMediaPublishSchema` is the row shape
    // `publishPost` parses on the way out (packages/api/src/posts.ts), so it is the boundary
    // that sees a hand-assembled set first; the row schema is what a read comes back through.
    const row = {
      id: '00000000-0000-0000-0000-000000000001',
      post_id: '00000000-0000-0000-0000-000000000002',
      kind: 'image',
      storage_path: 'uid/post/9.jpg',
      thumb_path: null,
      width: 1080,
      height: 1350,
      duration_s: null,
      created_at: '2026-08-28T00:00:00.000Z',
      updated_at: '2026-08-28T00:00:00.000Z',
    };
    const last = POST_MEDIA_MAX_COUNT - 1;
    const publish = { kind: 'image', storage_path: row.storage_path };
    expect(postMediaSchema.parse({ ...row, position: last }).position).toBe(last);
    expect(postMediaPublishSchema.parse({ ...publish, position: last }).position).toBe(last);
    expect(() => postMediaSchema.parse({ ...row, position: last + 1 })).toThrow();
    expect(() => postMediaPublishSchema.parse({ ...publish, position: last + 1 })).toThrow();
  });

  it('is bounded by a UNIQUE (post_id, position) index, which is the other half of the cap', () => {
    // The position bound alone caps nothing: it is the uniqueness of (post_id, position) that
    // turns "ten admissible values" into "at most ten rows". Drop the index and a post takes a
    // thousand rows at position 0 while every number above still agrees. pgTAP 0012 asserts the
    // 23505 at runtime; this asserts no migration ever took the index away — the half a
    // from-zero replay of a future migration would change.
    //
    // Newlines collapsed first: `drop index if exists\n  public.post_media_post_position;` is
    // one statement written across two lines, and a per-line search would not see it.
    const all = migrations();

    // Anchored at both ends of the STATEMENT, so a re-creation as a PARTIAL index (`… where
    // deleted_at is null`) does not satisfy this arm: a partial index bounds only the rows its
    // predicate admits, which is not a cap.
    const created = all.filter(({ statements }) =>
      statements.some((s) =>
        /^create unique index post_media_post_position on public\.post_media \(post_id, position\)$/.test(
          s,
        ),
      ),
    );
    expect(created.length, 'no migration creates post_media_post_position').toBeGreaterThan(0);

    // Containment rather than a pattern with an escape in it: `drop index` takes several
    // spellings (`if exists`, a schema qualifier, `concurrently`) and the claim is only that no
    // statement drops this index at all.
    const dropped = all.filter(({ statements }) =>
      statements.some((s) => s.includes('drop index') && s.includes('post_media_post_position')),
    );
    expect(
      dropped.map((m) => m.name),
      'a migration drops post_media_post_position',
    ).toEqual([]);
  });
});
