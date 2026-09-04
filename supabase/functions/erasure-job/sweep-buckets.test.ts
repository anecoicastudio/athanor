// Run via `cd supabase/functions && deno test --allow-env --allow-read .` (CI edge job).
//
// #573 — the guard that did not exist when `chat-media` landed.
//
// A GDPR erasure's byte reach is a list of buckets, and until this test that list had no
// completeness check of any kind. `supabase/tests/0096` forces a new personal-data TABLE to
// declare its export fate; nothing forced a new BUCKET to declare its erasure fate, which is
// exactly how five buckets' bytes came to survive an erasure: each one was created in its own
// migration, and the erasure's single hardcoded `bucket_id = 'candidacy-videos'` was never
// revisited. The bug was invisible because the erasure job kept working.
//
// Three files hold one invariant, in three languages:
//   - `gdpr_storage_footprint`'s `in (…)` list in supabase/migrations — what erasure sweeps;
//   - `insert into storage.buckets` across supabase/migrations — what exists;
//   - `MediaBucketName` in packages/api/src/storage.ts — what the apps upload to.
// This asserts them against each other. Reading the migrations rather than a live database is
// the same choice media-process/buckets.test.ts made and for the same reason: the edge job has
// no Postgres, and the migrations are what a replay from zero produces.
import { assert, assertEquals } from 'jsr:@std/assert@1';

const MIGRATIONS = new URL('../../migrations/', import.meta.url);
const API_STORAGE = new URL('../../../packages/api/src/storage.ts', import.meta.url);

/**
 * Prose naming the function must not count as touching it — this migration's own header names
 * `gdpr_storage_footprint` several times in `--` comments before the DDL. Not quote-aware: a
 * `--` inside a string literal truncates the rest of that line, which can only hide a mention,
 * never invent one, and DDL on its own line always survives.
 */
function stripSqlComments(sql: string): string {
  return sql.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--[^\n]*/g, '');
}

async function migrationFiles(): Promise<string[]> {
  const files: string[] = [];
  for await (const entry of Deno.readDir(MIGRATIONS)) {
    if (entry.isFile && entry.name.endsWith('.sql')) files.push(entry.name);
  }
  return files.sort(); // timestamp-prefixed, so lexical order is application order
}

/**
 * The bucket list from the LAST `create … function public.gdpr_storage_footprint` in migration
 * order. Last, not first: migrations are append-only, so a later `create or replace` is how the
 * list is legitimately widened.
 */
async function bucketsFromSweepFunction(): Promise<Set<string>> {
  let latest: Set<string> | null = null;
  let source = '';
  let lastMentioned = ''; // any file whose SQL (comments stripped) names the function, parsed or not

  for (const name of await migrationFiles()) {
    const sql = stripSqlComments(await Deno.readTextFile(new URL(name, MIGRATIONS)));
    if (/gdpr_storage_footprint/i.test(sql)) lastMentioned = name;
    // `create [or replace] function public.gdpr_storage_footprint … o.bucket_id in ('a', 'b', …)`
    const re =
      /create\s+(?:or\s+replace\s+)?function\s+public\.gdpr_storage_footprint[\s\S]*?bucket_id\s+in\s*\(([^)]*)\)/gi;
    for (const m of sql.matchAll(re)) {
      latest = new Set([...m[1].matchAll(/'([^']+)'/g)].map((q) => q[1]));
      source = name;
    }
  }

  assert(
    latest !== null,
    'no `create function public.gdpr_storage_footprint` with a bucket_id IN list found in ' +
      'supabase/migrations — the erasure sweep has no bucket list to check',
  );
  assert(latest.size > 0, `${source}: the sweep's IN list parsed to an empty bucket list`);

  // The parser understands `in ('a', 'b')` and nothing else. A later migration that rewrites the
  // predicate as `= any(array[…])`, or narrows it, would leave `latest` holding an OLDER file's
  // list — and every assertion below would pass while saying nothing about the function that
  // actually exists. A false pass is the one outcome this file must not produce.
  assertEquals(
    source,
    lastMentioned,
    `${lastMentioned} touches gdpr_storage_footprint but this test could not parse a bucket ` +
      `list from it (it parsed ${source} instead). Teach the parser that file's syntax — until ` +
      `then this test is asserting against a stale sweep.`,
  );
  return latest;
}

/**
 * Every bucket any migration creates, from `insert into storage.buckets (id, …) values (…)`.
 *
 * This one must fail CLOSED. A bucket it cannot see is a bucket the comparison below then
 * silently agrees about — which is the exact shape of the bug this file exists to catch, only
 * with a green test on top of it. So every assumption the parser makes is asserted rather than
 * relied on: `id` first in the column list, at least one tuple per insert, and no bucket created
 * through a route this parser does not read at all.
 *
 * What it deliberately does NOT require (an earlier draft did, and each was a way to fail open):
 * that `name` repeat `id`, that `public` be a bare boolean, or that the column list be exactly
 * the five the current migrations happen to use.
 */
async function declaredBuckets(): Promise<Set<string>> {
  const declared = new Set<string>();
  for (const file of await migrationFiles()) {
    // Comments stripped FIRST: a commented-out example tuple is not a bucket, and counting one
    // would invent a name the sweep list cannot match.
    const sql = stripSqlComments(await Deno.readTextFile(new URL(file, MIGRATIONS)));

    // Supabase also exposes `storage.create_bucket('id', …)`. Nothing uses it today; this parser
    // cannot read it, so its appearance must stop the test rather than be skipped past.
    assert(
      !/storage\.create_bucket\s*\(/i.test(sql),
      `${file} creates a bucket via storage.create_bucket(), which this parser does not read. ` +
        `Teach it that form — until then the erasure sweep's completeness check is blind to it.`,
    );

    const inserts = [
      ...sql.matchAll(/insert\s+into\s+storage\.buckets\s*\(([^)]*)\)\s*values([\s\S]*?);/gi),
    ];
    // An `insert into storage.buckets` this regex could not shape into (columns) values (…);
    const unparsed =
      (sql.match(/insert\s+into\s+storage\.buckets/gi) ?? []).length - inserts.length;
    assert(
      unparsed === 0,
      `${file} has ${unparsed} \`insert into storage.buckets\` this test could not parse. ` +
        `Teach the parser that file's syntax — until then it is asserting against a bucket set ` +
        `it knows to be incomplete.`,
    );

    for (const [, columns, values] of inserts) {
      // The parser reads the bucket id as the first quoted literal of each tuple, so `id` being
      // the first column is load-bearing rather than incidental.
      const first = columns.split(',')[0].trim().replace(/"/g, '').toLowerCase();
      assert(
        first === 'id',
        `${file}: \`insert into storage.buckets\` lists '${first}' first, not 'id'. This test ` +
          `reads the bucket id positionally; reordering the columns silently changes what it ` +
          `thinks the bucket is called.`,
      );
      // `array['image/jpeg', …]` uses brackets, so a tuple's opening paren is unambiguous here.
      const names = [...values.matchAll(/\(\s*'([^']+)'/g)].map((m) => m[1]);
      assert(
        names.length > 0,
        `${file}: an \`insert into storage.buckets\` yielded no bucket id. Teach the parser its ` +
          `VALUES syntax rather than letting a created bucket go unseen.`,
      );
      for (const n of names) declared.add(n);
    }
  }
  assert(declared.size > 0, 'no bucket found in supabase/migrations — the parser is broken');
  return declared;
}

/** The `MediaBucketName` union in packages/api — what the apps can upload to. */
async function mediaBucketNames(): Promise<Set<string>> {
  const src = await Deno.readTextFile(API_STORAGE);
  const m = src.match(/export\s+type\s+MediaBucketName\s*=([\s\S]*?);/);
  assert(m, 'packages/api/src/storage.ts no longer declares `export type MediaBucketName = …;`');
  const names = new Set([...m[1].matchAll(/'([^']+)'/g)].map((q) => q[1]));
  assert(names.size > 0, 'MediaBucketName parsed to an empty union');
  return names;
}

Deno.test('the erasure sweep covers every bucket the migrations create', async () => {
  const sweep = await bucketsFromSweepFunction();
  const declared = await declaredBuckets();

  assertEquals(
    [...sweep].sort(),
    [...declared].sort(),
    "gdpr_storage_footprint's bucket list and the buckets the migrations create disagree. A " +
      "bucket that exists but is not swept keeps an erased member's bytes forever (that is " +
      '#573); a bucket swept but never created is a typo that silently sweeps nothing. Add the ' +
      'new bucket to the sweep in a NEW migration, or say in that migration why it is exempt.',
  );
});

Deno.test('every bucket the apps upload to is swept', async () => {
  // The other direction of the same invariant, from the client side: packages/api is the only
  // door to `upload()`, so anything in this union is a bucket a member can put bytes in.
  const sweep = await bucketsFromSweepFunction();
  const missing = [...(await mediaBucketNames())].filter((b) => !sweep.has(b)).sort();
  assertEquals(
    missing,
    [],
    `MediaBucketName lists ${missing.join(', ')}, which a GDPR erasure never deletes from`,
  );
});

Deno.test('the swept buckets that are NOT user-upload targets are named deliberately', async () => {
  // Pins the one judgement call in the list, so a future non-media bucket cannot be swept (or
  // skipped) without someone editing this line and thinking about it.
  //
  // `exports` holds gdpr-export-job's archives at `{profile_id}/{job_id}.json` — the member's
  // entire personal dataset in one object, retained indefinitely. Nothing else in the tree ever
  // calls `.remove()` on it. Erasing a member while leaving those behind would leave the most
  // complete copy of their data on disk, so it IS in scope, despite not being user-uploaded.
  const sweep = await bucketsFromSweepFunction();
  const media = await mediaBucketNames();
  assertEquals([...sweep].filter((b) => !media.has(b)).sort(), ['exports']);
});
