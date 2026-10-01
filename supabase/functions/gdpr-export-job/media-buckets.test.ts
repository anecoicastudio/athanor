// Run via `cd supabase/functions && deno test --allow-env --allow-read .` (CI edge job).
//
// #784 — the export's media reach and the erasure's byte reach are one list, held in two SQL
// functions and one constant:
//   - `gdpr_storage_footprint`'s `in (…)` list — what erasure sweeps (erasure-job's
//     sweep-buckets.test.ts pins it against every bucket that exists);
//   - `gdpr_export_media`'s `in (…)` list — what the archive copies as the member's own media;
//   - `EXPORT_MEDIA_BUCKETS` in ./logic.ts — what the job and its manifest say they cover.
// The export list is the erasure list minus `exports` (the archives themselves, which an export
// must not copy into the next one). Held here so a new media bucket cannot join the erasure
// without joining the export — a member could otherwise have bytes erased that they were never
// able to download.
import { assert, assertEquals } from 'jsr:@std/assert@1';
import { EXPORT_MEDIA_BUCKETS } from './logic.ts';

const MIGRATIONS = new URL('../../migrations/', import.meta.url);

function stripSqlComments(sql: string): string {
  return sql.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--[^\n]*/g, '');
}

/** The bucket list of the LAST migration that (re)creates `fn`; fails if a later file names it unparsed. */
async function bucketsOf(fn: string): Promise<string[]> {
  const files: string[] = [];
  for await (const e of Deno.readDir(MIGRATIONS)) {
    if (e.isFile && e.name.endsWith('.sql')) files.push(e.name);
  }
  files.sort();
  let latest: string[] | null = null;
  let source = '';
  let lastMentioned = '';
  const re = new RegExp(
    `create\\s+(?:or\\s+replace\\s+)?function\\s+public\\.${fn}\\b[\\s\\S]*?bucket_id\\s+in\\s*\\(([^)]*)\\)`,
    'gi',
  );
  for (const name of files) {
    const sql = stripSqlComments(await Deno.readTextFile(new URL(name, MIGRATIONS)));
    if (new RegExp(`\\b${fn}\\b`, 'i').test(sql)) lastMentioned = name;
    for (const m of sql.matchAll(re)) {
      latest = [...m[1].matchAll(/'([^']+)'/g)].map((q) => q[1]);
      source = name;
    }
  }
  assert(latest && latest.length > 0, `no bucket list parsed for ${fn}`);
  // A later file that touches the function in a shape this parser cannot read would leave
  // `latest` holding an older list and every assertion below passing against it.
  assertEquals(
    source,
    lastMentioned,
    `${lastMentioned} touches ${fn} but no bucket list parsed from it`,
  );
  return latest;
}

Deno.test('the export copies exactly the buckets erasure sweeps, less `exports`', async () => {
  const erasure = await bucketsOf('gdpr_storage_footprint');
  const exportMedia = await bucketsOf('gdpr_export_media');
  assert(erasure.includes('exports'), 'the erasure sweep still reaches the archives');
  assertEquals(
    [...exportMedia].sort(),
    erasure.filter((b) => b !== 'exports').sort(),
    'gdpr_export_media = gdpr_storage_footprint − exports',
  );
  assertEquals([...EXPORT_MEDIA_BUCKETS].sort(), [...exportMedia].sort());
});
