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
 * `reserved-handles.mirror.test.ts` and `audit-log-actions.mirror.test.ts` alongside this file,
 * and `packages/core/src/onboarding/affinity.mirror.test.ts`, carry the same note.)
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
 *
 * A name added here is watched across every `create policy` and `alter policy` that ever names
 * it, so a policy joining this list does not need its history curated.
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
 * Every whole-key pin inside one policy statement.
 *
 * Scoped to a statement rather than swept over the file for the reason
 * `post-media-duration.mirror.test.ts` scopes its inline read: the same migration also carries
 * per-SEGMENT uuid guards (`~* '^{uuid}$'`, on the read policy), and an unscoped sweep would
 * compare one of those against a three-segment key and fail for the wrong reason. A pin is
 * recognised by its shape — anchored, ending in the `.jpg` extension — not by its position.
 */
function pinsIn(statement: string): Pin[] {
  const pins: Pin[] = [];
  for (const match of statement.matchAll(/~(\*?)\s*'([^']*)'/g)) {
    const pattern = match[2]!;
    if (!pattern.startsWith('^') || !pattern.endsWith('\\.jpg$')) continue;
    pins.push({ pattern, caseInsensitive: match[1] === '*' });
  }
  return pins;
}

interface Statement {
  file: string;
  /** `create` or `alter` — both can put a predicate in force. */
  kind: string;
  text: string;
}

/**
 * Every `create policy` AND `alter policy` statement in the migration history, keyed by policy
 * name, in application order.
 *
 * `alter policy` is here because leaving it out is a silent hole rather than a smaller net: this
 * repo already changes predicates that way in several migrations
 * (`grep -l 'alter policy' supabase/migrations` says which, and stays right as they accrue). A
 * later `alter policy "chat-media_insert_own" … with check
 * (… name ~ '^[0-9a-fA-F]{8}…' …)` would widen the database to accept the uppercase-hex key this
 * package refuses, while a create-only reader went on quoting the stale text from
 * 20260827092629 and passing — the exact drift this file exists to make impossible. Sweeping
 * every statement, not just the last one, is what makes that fail: a widened pin is a wrong pin
 * wherever it is written.
 *
 * A statement runs from its keyword to the start of the next one (or end of file). That
 * over-reads any trailing `drop policy`, `comment on` or `grant`, which is harmless — `pinsIn`
 * recognises whole-key patterns only, and none of those carry one.
 */
const statementsByPolicy: () => Map<string, Statement[]> = (() => {
  let cached: Map<string, Statement[]> | undefined;
  return () => {
    if (cached !== undefined) return cached;
    const dir = join(ROOT, 'supabase', 'migrations');
    const byName = new Map<string, Statement[]>();
    for (const file of readdirSync(dir)
      .filter((f) => f.endsWith('.sql'))
      .sort()) {
      const sql = readFileSync(join(dir, file), 'utf8');
      const heads = [
        ...sql.matchAll(/\b(create|alter)\s+policy\s+(?:"([^"]+)"|([a-zA-Z_][a-zA-Z0-9_$]*))/gi),
      ];
      heads.forEach((head, i) => {
        const start = head.index;
        const end = i + 1 < heads.length ? heads[i + 1]!.index : sql.length;
        // Quoted OR bare, because this repo writes policy names BOTH ways — neither branch of
        // the alternation is dead. `chat-media_*` must be quoted (the hyphen forces it), while
        // `messages_insert_own_user` needs no quotes, and the `alter policy` statements already
        // in the migrations are split between the two forms. A quoted-only reader watched two of
        // these three names and silently ignored the third.
        const name = head[2] ?? head[3]!;
        const list = byName.get(name) ?? [];
        list.push({ file, kind: head[1]!.toLowerCase(), text: sql.slice(start, end) });
        byName.set(name, list);
      });
    }
    cached = byName;
    return cached;
  };
})();

function statementsFor(name: string): Statement[] {
  const statements = statementsByPolicy().get(name);
  if (statements === undefined || statements.length === 0) {
    throw new Error(`no migration creates or alters a policy named ${name}`);
  }
  return statements;
}

/** Every pin ever written for a policy, across create and alter alike. */
function allPinsFor(name: string): { statement: Statement; pin: Pin }[] {
  const found = statementsFor(name).flatMap((statement) =>
    pinsIn(statement.text).map((pin) => ({ statement, pin })),
  );
  if (found.length === 0) {
    throw new Error(`${name} declares no whole-key shape pin in any migration`);
  }
  return found;
}

/**
 * The LAST statement that declares any pin — the one whose halves are actually in force.
 *
 * Deliberately "last statement carrying a pin" rather than "last statement": an `alter policy`
 * that only changes roles carries no predicate and must not read as "the pin was dropped". An
 * alter that restates ONE half of an UPDATE policy will make the both-halves assertion below go
 * red; that is intended, because a half-restated predicate is a shape worth re-deriving that
 * assertion for by hand rather than inferring.
 */
function lastPinningStatement(name: string): Statement {
  const withPins = statementsFor(name).filter((s) => pinsIn(s.text).length > 0);
  const last = withPins.at(-1);
  if (last === undefined) {
    throw new Error(`${name} declares no whole-key shape pin in any migration`);
  }
  return last;
}

/**
 * A policy statement's two predicate halves, split on the `with check` keyword.
 *
 * Crude on purpose, and safe for a reason that survives the crudeness: a mis-split FAILS CLOSED.
 * It is not enough that `check` is no function and the halves are parenthesised — statement
 * ranges deliberately over-read to the next head, so the words can reach here inside a trailing
 * comment. Work both cases through. A stray "with check" BEFORE the real clause pushes both real
 * pins into `withCheck`, and the caller's `toHaveLength(1)` goes red. One AFTER it does not move
 * the first split at all, and `rest.join(' ')` puts the tail back. Neither produces a false
 * green, which is the only direction a guard may not fail in.
 *
 * `withCheck` is undefined for a statement declaring no such clause — the INSERT-policy shape,
 * and for an UPDATE policy a rule-2 violation the caller reports as one.
 */
function halvesOf(statement: Statement): { using: string; withCheck: string | undefined } {
  const [using, ...rest] = statement.text.split(/\bwith\s+check\b/i);
  return { using: using ?? '', withCheck: rest.length > 0 ? rest.join(' ') : undefined };
}

describe('the chat-media key shape is one pattern in two languages', () => {
  it('every whole-key pin ever written spells exactly chatMediaKey', () => {
    // The mirror itself. A segment class widened on one side only, a second extension admitted
    // in SQL, an anchor dropped — each shows up here as a string inequality naming the policy.
    // Swept over EVERY create and alter rather than only the one in force: an `alter policy` that
    // widens the pattern is wrong at the moment it is written, and reading only the newest
    // statement is how a create-only mirror would have missed it entirely.
    const expected = asSqlPattern(chatMediaKey);
    for (const name of PINNING_POLICIES) {
      for (const { statement, pin } of allPinsFor(name)) {
        expect(
          pin.pattern,
          `${name} pins a shape the schema does not (${statement.kind} policy in ${statement.file})`,
        ).toBe(expected);
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
      for (const { statement, pin } of allPinsFor(name)) {
        expect(
          pin.caseInsensitive,
          `${name} pins with ~* in ${statement.file} (case-insensitive)`,
        ).toBe(false);
      }
    }
  });

  it('pins the shape in BOTH halves of the UPDATE policy', () => {
    // A USING-only pin would let an existing object be renamed INTO a shape the insert path
    // refuses — the upsert-retry path is the one place a chat-media key can move at all.
    //
    // Split into halves rather than counted: "two pins in the statement" is satisfied by two pins
    // both sitting in `using (…)`, which is precisely the arrangement the sentence above says is
    // unsafe. A count would have made this assertion weaker than its own name.
    const { using, withCheck } = halvesOf(lastPinningStatement('chat-media_update_own'));
    expect(pinsIn(using), 'the UPDATE policy USING half carries no shape pin').toHaveLength(1);
    expect(withCheck, 'the UPDATE policy declares no WITH CHECK half').not.toBeUndefined();
    expect(pinsIn(withCheck ?? ''), 'the UPDATE WITH CHECK half carries no shape pin').toHaveLength(
      1,
    );
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
