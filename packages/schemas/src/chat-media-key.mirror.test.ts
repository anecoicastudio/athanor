import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { chatMediaKey, messageInsertSchema } from './message.ts';

/**
 * One storage-key shape, written down in TWO languages (#155, pinned by #575): the
 * `chatMediaKey` regex in this package, and the POSIX pattern the three chat-media WRITE
 * policies spell in SQL. `post-media-duration.mirror.test.ts` closes the same class of claim for
 * a number, `reserved-handles.mirror.test.ts` for a list.
 *
 * This issue IS the drift it guards against, and it drifted in the direction nothing notices:
 * 20260827054252 pinned only `media_url like '{sender}/{conversation}/%'` on messages and only
 * `(storage.foldername(name))[1]`/`[2]` on the bucket, while this package pinned the whole
 * anchored three-segment `.jpg` shape. `%` matches zero characters and any depth, and
 * `storage.foldername` drops the last segment entirely, so the database accepted
 * `{uid}/{conv}/`, `{uid}/{conv}/sub/dir/anything.exe` and an uppercase-hex key — all of which
 * this file's regex refuses. Nothing was exposed (the sender-folder and conversation-membership
 * predicates carry the authorization, untouched), but "the client and the server agree about
 * what a key is" was a claim no test made.
 *
 * The comparison is byte-for-byte after ONE normalization, and none of that is an accident of
 * formatting:
 *
 *   * `standard_conforming_strings` is `on` in Postgres, so `\.` inside a SQL literal is
 *     backslash-dot — the same two characters JS `'\\.'` produces. No unescaping is owed there.
 *   * `RegExp.prototype.source` DOES escape the forward slash (`\/`), so that its value stays
 *     valid if re-embedded in a `/…/` literal. A POSIX pattern has no delimiter and no such
 *     rule, so SQL spells a bare `/`. `asSqlPattern` undoes exactly that, and throws if any
 *     other escape appears — a silent `.replaceAll` would let a JS-only construct through and
 *     call the two sides equal.
 *   * POSIX `~` is case-SENSITIVE, matching a `[0-9a-f]` class carrying no `i` flag. The
 *     migration's older `~*` segment guards were not, which is why an uppercase-hex key used to
 *     pass SQL and fail Zod. The operator is asserted below for that reason — a `~*` would make
 *     the two patterns equal as strings while unequal as predicates.
 */
/**
 * Found by walking UP from this file, not by counting `../`: Stryker runs the suite from a
 * sandbox copy of the package (`.stryker-tmp/sandbox-N/`), two levels deeper than the package
 * sits in the repo, where a fixed relative path resolves to `packages/schemas/supabase/
 * migrations` and kills the dry run. (`post-media-duration.mirror.test.ts`,
 * `reserved-handles.mirror.test.ts`, `audit-log-actions.mirror.test.ts` and
 * `affinity.mirror.test.ts` carry the same note.)
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
 * The three policies that pin a WHOLE chat-media key, and the only ones this test speaks for.
 *
 * `chat-media_select_participant` is deliberately absent: #575 left the read side pinning path
 * SEGMENTS only, because tightening a read predicate retroactively hides bytes that are already
 * stored, and a filename tells a reader nothing that conversation membership and
 * not_blocked/not_banned do not already decide. Shape is enforced where a key is created. If a
 * later migration does pin the read side, add it here rather than letting it drift unwatched.
 */
const PINNING_POLICIES = [
  'messages_insert_own_user',
  'chat-media_insert_own',
  'chat-media_update_own',
] as const;

/**
 * `chatMediaKey` as a POSIX pattern: its `.source` with the JS-only slash escaping undone.
 *
 * Narrow on purpose. `\.` is the only escape either language is expected to carry, so anything
 * else surviving the unescape means the two notations have genuinely diverged (a `\d`, a `\b`, a
 * lookahead's `\1`) and the mirror can no longer speak for them. Throwing names that; returning
 * a normalized string would quietly assert an equivalence nobody checked.
 */
function asSqlPattern(re: RegExp): string {
  const pattern = re.source.replaceAll('\\/', '/');
  const escapes = [...pattern.matchAll(/\\[\s\S]/g)].map((m) => m[0]);
  const foreign = escapes.filter((e) => e !== '\\.');
  if (foreign.length > 0) {
    throw new Error(
      `chatMediaKey escapes more than the dot (${foreign.join(' ')}); SQL cannot mirror it verbatim`,
    );
  }
  return pattern;
}

interface Pin {
  /** The SQL literal's contents, verbatim. */
  pattern: string;
  /** True for `~*`. Always a failure here — see the header. */
  caseInsensitive: boolean;
}

/**
 * Every whole-key pin inside one `create policy` block.
 *
 * Scoped to a policy block rather than swept over the file for the reason
 * `post-media-duration.mirror.test.ts` scopes its inline read: the same migration also carries
 * per-SEGMENT uuid guards (`~* '^{uuid}$'`, on the read policy), and an unscoped sweep would
 * compare one of those against a three-segment key and fail for the wrong reason. A pin is
 * recognised by its shape — anchored, ending in the `.jpg` extension — not by its position.
 */
function pinsIn(block: string): Pin[] {
  const pins: Pin[] = [];
  for (const match of block.matchAll(/~(\*?)\s*'([^']*)'/g)) {
    const pattern = match[2]!;
    if (!pattern.startsWith('^') || !pattern.endsWith('\\.jpg$')) continue;
    pins.push({ pattern, caseInsensitive: match[1] === '*' });
  }
  return pins;
}

/**
 * The `create policy` body in force for each name: the LAST one written, since migrations are
 * append-only and a predicate is changed by drop-and-recreate under the same name (which is also
 * why `supabase/tests/0030_messages_rls.test.sql` and `0121_grant_catalog_sweep.test.sql` can go
 * on keying off these names).
 *
 * A block runs from its name to the next `create policy` or end of file. That over-reads any
 * trailing statement, which is harmless: `pinsIn` only recognises whole-key patterns, and a
 * `comment on` or a `drop policy` carries none.
 */
function policiesInForce(): Map<string, { file: string; block: string }> {
  const dir = join(ROOT, 'supabase', 'migrations');
  const inForce = new Map<string, { file: string; block: string }>();
  for (const file of readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort()) {
    const sql = readFileSync(join(dir, file), 'utf8');
    for (const block of sql.split(/create policy\s+/i).slice(1)) {
      const name = block.match(/^"([^"]+)"/)?.[1];
      if (name !== undefined) inForce.set(name, { file, block });
    }
  }
  return inForce;
}

function pinsFor(name: string): Pin[] {
  const found = policiesInForce().get(name);
  if (found === undefined) throw new Error(`no migration creates a policy named ${name}`);
  const pins = pinsIn(found.block);
  if (pins.length === 0) {
    throw new Error(`${name} (last created in ${found.file}) declares no whole-key shape pin`);
  }
  return pins;
}

describe('the chat-media key shape is one pattern in two languages', () => {
  it('every policy that pins a whole key spells exactly chatMediaKey', () => {
    // The mirror itself. A segment class widened on one side only, a second extension admitted
    // in SQL, an anchor dropped — each shows up here as a string inequality naming the policy.
    const expected = asSqlPattern(chatMediaKey);
    for (const name of PINNING_POLICIES) {
      for (const pin of pinsFor(name)) {
        expect(pin.pattern, `${name} pins a shape the schema does not`).toBe(expected);
      }
    }
  });

  it('differs from .source only by the slash escaping JS adds and POSIX has no use for', () => {
    // Stated out loud so the normalization above reads as a known asymmetry rather than as a
    // fudge. If a future engine stops escaping the slash, this goes red and the helper — not the
    // pin — is what needs revisiting.
    expect(chatMediaKey.source).toContain('\\/');
    expect(asSqlPattern(chatMediaKey)).not.toContain('\\/');
    expect(asSqlPattern(chatMediaKey).replaceAll('/', '\\/')).toBe(chatMediaKey.source);
  });

  it('pins with the case-SENSITIVE operator, because the class has no i flag', () => {
    // `~*` would compare equal as a string and behave differently as a predicate: it accepts the
    // uppercase-hex key this package refuses. That asymmetry is what #575 found on the segment
    // guards, so the replacement is asserted not to reintroduce it.
    for (const name of PINNING_POLICIES) {
      for (const pin of pinsFor(name)) {
        expect(pin.caseInsensitive, `${name} pins with ~* (case-insensitive)`).toBe(false);
      }
    }
  });

  it('pins the shape in BOTH halves of the UPDATE policy', () => {
    // A USING-only pin would let an existing object be renamed INTO a shape the insert path
    // refuses — the upsert-retry path is the one place a chat-media key can move at all.
    expect(pinsFor('chat-media_update_own')).toHaveLength(2);
  });

  it('is the three-segment lowercase-uuid .jpg key, and not merely two copies of whatever it became', () => {
    // The literal is asserted once, here. Without it both sides could move together and this
    // file would stay green while the path convention (#155) changed underneath the bucket, the
    // builder in apps/native, and the migration prose that all describe it.
    const seg = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
    expect(asSqlPattern(chatMediaKey)).toBe(`^${seg}/${seg}/${seg}\\.jpg$`);
    // No `i`: the lowercase-only class is half of what makes the case-sensitive `~` correct.
    expect(chatMediaKey.flags).toBe('');
  });

  it('is the shape the schema actually enforces, not a constant beside it', () => {
    // A regex nothing reads is a comment. These are the four keys the DB used to accept and the
    // schema did not — the drift, stated as inputs.
    const sender = '11111111-1111-4111-8111-111111111111';
    const conv = '22222222-2222-4222-8222-222222222222';
    // Hex LETTERS, deliberately: an all-digit media id makes the uppercase case below a no-op
    // that passes for the wrong reason.
    const media = 'aaaabbbb-cccc-4ddd-8eee-ffff33334444';
    const insert = { conversation_id: conv, sender_id: sender };
    const key = `${sender}/${conv}/${media}.jpg`;
    expect(messageInsertSchema.parse({ ...insert, media_url: key }).media_url).toBe(key);
    for (const refused of [
      `${sender}/${conv}/`,
      `${sender}/${conv}/sub/${media}.jpg`,
      `${sender}/${conv}/${media}.png`,
      `${sender}/${conv}/${media.toUpperCase()}.jpg`,
    ]) {
      expect(() => messageInsertSchema.parse({ ...insert, media_url: refused }), refused).toThrow();
    }
  });
});
