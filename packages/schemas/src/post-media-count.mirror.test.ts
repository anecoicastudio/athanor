import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * How many media rows one post may carry, written down in TWO languages (#591):
 * `MEDIA_LIMITS.MAX_POST_MEDIA` in `@athanor/core`, and the pair of SQL objects that actually
 * refuse the eleventh row. `post-media-duration.mirror.test.ts` closes the same class of claim
 * for the clip length, and is the shape this file follows.
 *
 * Two languages and not four, deliberately. There is no `.max()` in this package to pin: the
 * request side of a publish is an array the RPC assembles, and putting a `.max()` on the
 * RESULT schema would make a post that somehow exceeded the cap unreadable rather than
 * unwritable — the wrong failure for a read path. And no catalog sentence says the number out
 * loud: the composer disables the attach button at ten rather than explaining itself, so there
 * is no member-facing prose to drift. If either ever changes, this file grows the arm.
 *
 * The drift it guards against is the one #591 filed: the cap was a property of ONE screen.
 * `MEDIA_LIMITS.MAX_POST_MEDIA` was read at three sites, all of them in post-compose, and
 * neither `publish_post` nor `post_media` bounded anything — so a member calling
 * `/rest/v1/rpc/publish_post` or `POST /rest/v1/post_media` directly could attach a media set
 * of any size to their own post. Moving the cap into SQL makes it a migration-gated product
 * constant: the number now changes with a migration or not at all, and this test is what says
 * so when someone edits only the constant.
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

function migrations(): { name: string; sql: string }[] {
  const dir = join(ROOT, 'supabase', 'migrations');
  return readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((name) => ({ name, sql: readFileSync(join(dir, name), 'utf8') }));
}

/**
 * The number of media rows one post may hold, as a single migration declares it — or undefined
 * if it declares nothing.
 *
 * It reads the bounds and COUNTS THE ADMISSIBLE POSITIONS rather than lifting the literal,
 * because the literal is not the cap. `post_media_post_position` is UNIQUE on
 * (post_id, position), so the cap is however many values `position` may take: `>= 0 and < 10`
 * is ten rows, and `>= 0 and <= 10` is ELEVEN while still reading "10" to anyone grepping for
 * the number. A test that pinned the literal would stay green through exactly that edit.
 *
 * The `create table` block declares `position` with a lower bound only (`check (position >=
 * 0)`), so it matches nothing here and contributes no cap — which is correct: before #591
 * there was none. A migration that removed the upper bound again would therefore make
 * `currentDatabaseCap()` throw rather than quietly agree with core.
 */
function declaredCap(sql: string): number | undefined {
  const m = sql.match(
    /add constraint post_media_position_check\s+check \("position" >= (\d+) and "position" (<=?) (\d+)\)/,
  );
  if (!m) return undefined;
  const low = Number(m[1]);
  const high = Number(m[3]);
  return m[2] === '<' ? high - low : high - low + 1;
}

/** The cap in force: the LAST migration to declare one, since migrations are append-only. */
function currentDatabaseCap(): number {
  const caps = migrations()
    .map(({ sql }) => declaredCap(sql))
    .filter((cap): cap is number => cap !== undefined);
  const last = caps.at(-1);
  if (last === undefined) {
    throw new Error('no migration bounds post_media.position — the row cap is not enforced in SQL');
  }
  return last;
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

describe('the post media-set cap is one number in two places', () => {
  it('the positions post_media admits are MEDIA_LIMITS.MAX_POST_MEDIA', () => {
    // If core drifts UP, the composer accepts an attachment the database then refuses: an
    // upload that finishes and a publish that raises 23514 on a card the member already saw
    // assembled. If SQL drifts up, the cap silently stops being the cap.
    expect(currentDatabaseCap()).toBe(coreMaxPostMedia());
  });

  it('is 10, and not merely two copies of whatever it became', () => {
    // The literal is asserted once, here. Without it both could move together and this file
    // would stay green while the product decision was quietly reversed.
    expect(coreMaxPostMedia()).toBe(10);
  });

  it('is bounded by a UNIQUE (post_id, position) index, which is the other half of the cap', () => {
    // The position bound alone caps nothing: it is the uniqueness of (post_id, position) that
    // turns "ten admissible values" into "at most ten rows". Drop the index and a post takes a
    // thousand rows at position 0 while every number above still agrees. pgTAP 0012 asserts the
    // 23505 at runtime; this asserts that no migration ever took the index away, which is the
    // half a from-zero replay of a future migration would change.
    const all = migrations();
    const created = all.filter(({ sql }) =>
      /create unique index post_media_post_position\s+on public\.post_media \(post_id, position\)/.test(
        sql,
      ),
    );
    expect(created.length, 'no migration creates post_media_post_position').toBeGreaterThan(0);

    // `strpos`-style containment rather than a pattern with an escape in it: `drop index` takes
    // several spellings (`if exists`, a schema qualifier, `concurrently`) and the claim is only
    // that no migration mentions dropping this index at all.
    const dropped = all.filter(({ sql }) =>
      sql
        .split('\n')
        .some((line) => line.includes('drop index') && line.includes('post_media_post_position')),
    );
    expect(
      dropped.map((m) => m.name),
      'a migration drops post_media_post_position',
    ).toEqual([]);
  });
});
