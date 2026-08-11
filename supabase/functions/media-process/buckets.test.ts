// Run via `cd supabase/functions && deno test --allow-env --allow-read .` (CI edge job).
//
// The bucket allowlist in buckets.ts and the `media_process_enqueue` WHEN clause in
// supabase/migrations are ONE invariant expressed in two languages, and nothing tied them
// together. They drifted the first time a bucket was added: 20260811072211 extended the trigger
// to `avatars` and left the TypeScript at four, so every avatar upload fired a pg_net round trip
// that answered `bucket not allowed` (400) and no face photo was ever stripped of its GPS.
//
// That direction of drift is the dangerous one. A bucket in the TS set but not in the trigger is
// merely dead code; a bucket in the trigger but not in the TS set looks wired — the trigger
// fires, the function answers, the migration comment claims the strip — and does nothing. Both
// directions are asserted here anyway, because a set comparison that only checks one way invites
// the next person to "fix" it by widening the wrong side.
//
// The trigger is read from the migrations rather than from a live database on purpose: this runs
// in the edge job, which has no Postgres, and the migrations are the source of truth for what
// will exist after a replay from zero.
import { assert, assertEquals } from 'jsr:@std/assert@1';
import { BUCKETS } from './buckets.ts';

const MIGRATIONS = new URL('../../migrations/', import.meta.url);

/**
 * The bucket list from the LAST `create trigger media_process_enqueue` in migration order.
 * Last, not first: migrations are append-only, so a later file dropping and recreating the
 * trigger is how the clause is legitimately changed (20260811072211 does exactly that).
 */
async function bucketsFromLatestTrigger(): Promise<Set<string>> {
  const files: string[] = [];
  for await (const entry of Deno.readDir(MIGRATIONS)) {
    if (entry.isFile && entry.name.endsWith('.sql')) files.push(entry.name);
  }
  files.sort(); // timestamp-prefixed, so lexical order is application order

  let latest: Set<string> | null = null;
  let source = '';
  for (const name of files) {
    const sql = await Deno.readTextFile(new URL(name, MIGRATIONS));
    // `create trigger media_process_enqueue … when (new.bucket_id in ('a', 'b', …))`
    const re = /create\s+trigger\s+media_process_enqueue[\s\S]*?when\s*\(\s*new\.bucket_id\s+in\s*\(([^)]*)\)/gi;
    for (const m of sql.matchAll(re)) {
      latest = new Set([...m[1].matchAll(/'([^']+)'/g)].map((q) => q[1]));
      source = name;
    }
  }

  assert(latest !== null, 'no `create trigger media_process_enqueue` found in supabase/migrations');
  assert(latest.size > 0, `${source}: the WHEN clause parsed to an empty bucket list`);
  return latest;
}

Deno.test('the strip allowlist matches the trigger that feeds it', async () => {
  const fromSql = await bucketsFromLatestTrigger();
  assertEquals(
    [...BUCKETS].sort(),
    [...fromSql].sort(),
    'buckets.ts and the media_process_enqueue WHEN clause disagree — a bucket the trigger ' +
      'enqueues but the function rejects is silently unstripped',
  );
});

Deno.test('every allowlisted bucket is a real private user-media bucket', async () => {
  // Guards the other way a set comparison can pass while being wrong: both sides edited to a
  // name that no bucket migration ever created.
  const declared = new Set<string>();
  for await (const entry of Deno.readDir(MIGRATIONS)) {
    if (!entry.isFile || !entry.name.endsWith('.sql')) continue;
    const sql = await Deno.readTextFile(new URL(entry.name, MIGRATIONS));
    if (!/insert\s+into\s+storage\.buckets/i.test(sql)) continue;
    for (const m of sql.matchAll(/\(\s*'([a-z0-9-]+)'\s*,\s*'\1'\s*,\s*(?:false|true)\b/gi)) {
      declared.add(m[1]);
    }
  }
  for (const b of BUCKETS) {
    assert(declared.has(b), `buckets.ts lists '${b}', which no migration creates`);
  }
});
