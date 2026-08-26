// Run via `cd supabase/functions && deno test --allow-env --allow-read .` (CI edge job).
//
// Rule #8 is the one project rule with no deterministic guard: a function's auth posture
// lives in config.toml, its gate lives in the handler, and nothing tied the two together.
// Getting it wrong is silent in both directions — verify_jwt=true on an internal function
// 401s every pg_net call with "Invalid JWT" (a secret key is not a JWT), and verify_jwt=false
// on a function whose handler forgot its gate publishes a service-role client to the internet.
//
// So this asserts the whole table explicitly, and that every function on disk appears in it.
import { assert, assertEquals } from 'jsr:@std/assert@1';

type Posture = 'user' | 'internal' | 'webhook';

/**
 * The declared auth posture of every edge function.
 *   user     — reachable by a signed-in client. verify_jwt=true AND requireUser() inside.
 *   internal — reached by pg_net/pg_cron with a secret key, which the platform cannot verify
 *              as a JWT. verify_jwt=false, requireServiceRole() is the ONLY gate.
 *   webhook  — reached by Stripe, which cannot present a Supabase credential at all.
 *              verify_jwt=false, authenticity comes from signature verification.
 * Adding a function means adding it here; the last test fails until you do.
 * Exported: auth-posture.test.ts discovers the user-callable family from this table, so a
 * function cannot dodge those tests by not matching a filename prefix (issue #271, was #141).
 */
export const POSTURE: Record<string, Posture> = {
  'announce-cycle': 'internal',
  'check-in': 'user',
  'close-cycle': 'internal',
  'create-circle-checkout': 'user',
  'create-circle-portal': 'user',
  'create-contribution-session': 'user',
  'create-payout-onboarding': 'user',
  'create-ticket-checkout': 'user',
  'create-verification-session': 'user',
  'declare-winner': 'internal',
  'erasure-job': 'internal',
  'gdpr-export-job': 'internal',
  'media-process': 'internal',
  'moderation-enforce': 'internal',
  'notification-fan-out': 'internal',
  'push-dispatch': 'internal',
  'release-fund-payout': 'internal',
  'score-engine': 'internal',
  'story-segment-reaper': 'internal',
  'screen-candidacy': 'internal',
  'stripe-webhook': 'webhook',
  'verify-plan-phase': 'internal',
};

const EXPECTED_VERIFY_JWT: Record<Posture, boolean> = {
  user: true,
  internal: false,
  webhook: false,
};

const CONFIG_PATH = new URL('../../config.toml', import.meta.url);
const FUNCTIONS_DIR = new URL('../', import.meta.url);

/** Minimal reader for the `[functions.<name>] verify_jwt = <bool>` blocks. */
function readVerifyJwt(toml: string): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  let current: string | null = null;
  for (const raw of toml.split('\n')) {
    const line = raw.trim();
    if (line.startsWith('#')) continue;
    const header = line.match(/^\[functions\.([A-Za-z0-9_-]+)\]$/);
    if (header) {
      current = header[1];
      continue;
    }
    if (line.startsWith('[')) {
      current = null;
      continue;
    }
    const kv = current && line.match(/^verify_jwt\s*=\s*(true|false)$/);
    if (kv && current) out[current] = kv[1] === 'true';
  }
  return out;
}

const declared = readVerifyJwt(Deno.readTextFileSync(CONFIG_PATH));

Deno.test('config.toml declares verify_jwt for every function, matching its posture', () => {
  for (const [name, posture] of Object.entries(POSTURE)) {
    assert(name in declared, `config.toml has no [functions.${name}] block`);
    assertEquals(
      declared[name],
      EXPECTED_VERIFY_JWT[posture],
      `${name} is declared '${posture}', so verify_jwt must be ${EXPECTED_VERIFY_JWT[posture]}`,
    );
  }
});

Deno.test('config.toml declares nothing that is not a function on disk', () => {
  for (const name of Object.keys(declared)) {
    assert(name in POSTURE, `config.toml declares [functions.${name}], which POSTURE omits`);
  }
});

Deno.test('every function directory on disk has a declared posture', () => {
  // Catches the real failure mode: a function shipped without a config.toml block silently
  // inherits the platform default (verify_jwt=true) and 401s every internal caller.
  const onDisk = [...Deno.readDirSync(FUNCTIONS_DIR)]
    .filter((e) => e.isDirectory && e.name !== '_shared' && !e.name.startsWith('.'))
    .map((e) => e.name)
    .sort();
  assertEquals(onDisk, Object.keys(POSTURE).sort());
});

// Body parse in ANY of its four forms. An earlier revision of the gate-order test matched
// the literal 'req.json()' only, so an `await req.text()` ahead of the gate passed — the
// same regex auth-posture.test.ts applies to the user-callable family (issue #271, was #139).
const BODY_READ = /\breq\.(json|text|formData|arrayBuffer)\s*\(/;

// The ONE function allowed to read the body before any gate, by name and on purpose:
// stripe-webhook's raw body IS its authentication input — the Stripe signature is computed
// over it, so verification cannot precede the read. A second webhook added tomorrow does
// not inherit this exemption by accident; it must be listed here with its own reason.
const RAW_BODY_IS_THE_CREDENTIAL = new Set(['stripe-webhook']);

Deno.test('every function gates itself before parsing the body, because nothing else does', () => {
  // verify_jwt=false means the network layer lets anyone in, and even verify_jwt=true only
  // proves a JWT is well-formed. The in-handler gate must be present AND must appear before
  // any body parse — a gate after `await req.json()` still lets an unauthenticated (or
  // merely well-formed) caller drive parsing.
  for (const name of RAW_BODY_IS_THE_CREDENTIAL) {
    assertEquals(
      POSTURE[name],
      'webhook',
      `${name} is exempt from gate-before-parse, which only a webhook posture can justify`,
    );
  }
  const GATE: Record<Posture, string | null> = {
    user: 'requireUser(req)',
    internal: 'requireServiceRole(req)',
    webhook: null, // gated by signature verification over the raw body, asserted separately
  };
  for (const [name, posture] of Object.entries(POSTURE)) {
    if (RAW_BODY_IS_THE_CREDENTIAL.has(name)) continue;
    const gateCall = GATE[posture];
    if (gateCall === null) continue;
    const src = Deno.readTextFileSync(new URL(`../${name}/index.ts`, import.meta.url));
    const gate = src.indexOf(gateCall);
    assert(gate > -1, `${name} is ${posture} but never calls ${gateCall}`);
    const parse = src.search(BODY_READ);
    assert(parse === -1 || gate < parse, `${name} parses the body before its gate`);
  }
});

Deno.test('webhook posture means a signature gate and a dedupe, not a config value', () => {
  // A webhook is verify_jwt=false with NO requireServiceRole — the signature over the raw
  // body is the only thing between the endpoint and the public internet, and the
  // stripe_webhook_events ledger is what makes a replayed event a no-op (rule 6). Until now
  // the posture table only restated the verify_jwt boolean, so a second webhook function
  // added tomorrow would have satisfied it without either protection. Source-level markers
  // are coarse, but they make the posture mean the two properties it names (issue #271,
  // was #144). Reference implementation: stripe-webhook/handlers.ts (constructEventAsync
  // over the exact received bytes; event-id upsert + atomic lease on stripe_webhook_events).
  for (const [name, posture] of Object.entries(POSTURE)) {
    if (posture !== 'webhook') continue;
    const dir = new URL(`../${name}/`, import.meta.url);
    const src = [...Deno.readDirSync(dir)]
      .filter((e) => e.isFile && e.name.endsWith('.ts') && !e.name.endsWith('.test.ts'))
      .map((e) => Deno.readTextFileSync(new URL(e.name, dir)))
      .join('\n');
    assert(
      /constructEventAsync|constructEvent\b/.test(src),
      `${name}: webhook posture but no Stripe signature-verification call in its source`,
    );
    assert(
      src.includes('stripe_webhook_events'),
      `${name}: webhook posture but no stripe_webhook_events dedupe in its source`,
    );
  }
});

// The calls that make a module-scope statement observable to an unauthenticated caller.
// `supabaseAdmin` and `stripeClient` are here for the same reason as the two platform calls:
// each reads a secret out of the environment and hands back a privileged client, so calling
// one at module scope is an env read wearing a different name (#541).
const IO_CALL = [
  /\bDeno\.env\.get\s*\(/,
  /\bfetch\s*\(/,
  /\bsupabaseAdmin\s*\(/,
  /\bstripeClient\s*\(/,
];

/**
 * The top-level statements of a source file, each as one line of text.
 *
 * Column 0 is the proxy for module scope — prettier indents every statement inside a function,
 * and it gates CI, so an unindented statement is a top-level one. Its continuation lines are
 * indented (or, for a block's closer or a wrapped return type, start with a closing bracket
 * — `): Promise<`…`> {` puts a bare `>` in column 0), so they are folded back into the
 * statement they belong to rather than skipped: `export const k =\n  Deno.env.get('K');` is one
 * module-scope read, and reading it line by line saw only the half without the call in it.
 * Comment lines are dropped so that prose inside a wrapped statement cannot trip the scan.
 */
function topLevelStatements(src: string): { line: number; text: string }[] {
  const out: { line: number; text: string }[] = [];
  for (const [i, raw] of src.split('\n').entries()) {
    const text = raw.trim();
    if (text === '' || text.startsWith('//') || text.startsWith('*') || text.startsWith('/*')) {
      continue;
    }
    if (/^\s/.test(raw) || /^[)\]}>`]/.test(text)) {
      if (out.length > 0) out[out.length - 1].text += ' ' + text;
      continue;
    }
    out.push({ line: i + 1, text });
  }
  return out;
}

/** Index just past the balanced `{…}` opening at `open`, or -1 if it never closes. */
function matchBrace(s: string, open: number): number {
  let depth = 0;
  for (let i = open; i < s.length; i++) {
    if (s[i] === '{') depth++;
    else if (s[i] === '}' && --depth === 0) return i + 1;
  }
  return -1;
}

/** Index just past a callback body starting at `from` — a `{…}` block, or an expression. */
function bodyEnd(s: string, from: number): number {
  let i = from;
  while (i < s.length && s[i] === ' ') i++;
  if (s[i] === '{') {
    const end = matchBrace(s, i);
    return end === -1 ? s.length : end;
  }
  // An expression body runs to the first separator at its own depth: `(n) => n, url: …`
  // ends at the comma, which is exactly the case a "is there an arrow earlier on the line"
  // rule got wrong — it treated the rest of the object literal as part of the callback.
  let depth = 0;
  for (; i < s.length; i++) {
    const c = s[i];
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') {
      if (depth === 0) return i;
      depth--;
    } else if ((c === ',' || c === ';') && depth === 0) return i;
  }
  return s.length;
}

/**
 * A statement with every function and arrow body blanked out, so what is left is only what
 * runs when the statement itself is evaluated. `{ get: (name) => Deno.env.get(name) }` keeps
 * its read; `{ get: (n) => n, url: Deno.env.get('K') }` loses only the callback and keeps the
 * eager read that follows it.
 *
 * A statement that DECLARES something — `function`, `class`, `type`, `interface` — is dropped
 * whole: a declaration is hoisted, never evaluated at import, so nothing in its body can run
 * however it is written. That also sidesteps having to find where a signature ends, which a
 * return type like `Promise<{ ok: true } | { ok: false }>` makes genuinely ambiguous for a
 * non-parser.
 *
 * An immediately-invoked body is NOT lazy — `const db = (() => supabaseAdmin())();` runs at
 * import like any other statement — so the wrapper's `)` followed by `(` stops the stripping
 * and the whole statement is judged eager.
 *
 * LIMIT: it does not parse. A `=>` inside a TYPE annotation on the same statement as an eager
 * call would blank the wrong span, so `const h: (r: Request) => R = make(Deno.env.get('K'))`
 * would slip through. Nothing in the tree has that shape; widen this rather than trust it if
 * one appears.
 */
function stripLazyBodies(text: string): string {
  if (/^(export\s+)?(default\s+)?(async\s+)?function\b/.test(text)) return '';
  if (/^(export\s+)?(default\s+)?(abstract\s+)?class\b/.test(text)) return '';
  if (/^(export\s+)?(type|interface)\b/.test(text)) return '';
  let out = text;
  for (let pass = 0; pass < 64; pass++) {
    const m = /=>|\bfunction\b/.exec(out);
    if (m === null) return out;
    const from = m[0] === 'function' ? out.indexOf('{', m.index) : m.index + m[0].length;
    // Always blank at least the token itself, so a body we cannot find still makes progress.
    const stop = Math.max(from === -1 ? -1 : bodyEnd(out, from), m.index + m[0].length);
    // `(() => …)()` — the body is called right here, so nothing about it is deferred.
    if (/^\)\s*\(/.test(out.slice(stop))) return out;
    out = out.slice(0, m.index) + ' '.repeat(stop - m.index) + out.slice(stop);
  }
  return out;
}

/** Module-scope I/O in a source file, as `<line>: performs I/O (<pattern>)` strings. */
function moduleScopeIo(src: string): string[] {
  const hits: string[] = [];
  for (const stmt of topLevelStatements(src)) {
    const eager = stripLazyBodies(stmt.text);
    for (const re of IO_CALL) {
      if (re.test(eager)) hits.push(`${stmt.line}: performs I/O (${re.source})`);
    }
  }
  return hits;
}

Deno.test('the module-scope scanner tells an eager read from a lazy one', () => {
  // The scanner is the only thing standing between rule 8 and a silent regression, and it is a
  // text heuristic — so its contract is pinned here rather than inferred from whether the tree
  // happens to be clean today. Every EAGER fixture is a shape that has occurred or nearly
  // occurred in this repo; every LAZY one is a shape the tree relies on.
  const EAGER: [string, string][] = [
    [
      'the #541 shape',
      "export const stripe = new Stripe(Deno.env.get('K')!, {\n  apiVersion: V,\n});",
    ],
    ['a prettier-wrapped statement', "export const k =\n  Deno.env.get('K');"],
    ['an eager read after a callback', "const c = { get: (n) => n, url: Deno.env.get('K') };"],
    ['a callback declared after the read', "const a = Deno.env.get('K');\nconst b = () => a;"],
    ['a service-role client', 'const db = supabaseAdmin();'],
    ['a Stripe client', 'const s = stripeClient();'],
    ['an import-time fetch', "await fetch('https://example.test');"],
    ['an immediately-invoked body', 'const db = (() => supabaseAdmin())();'],
  ];
  const LAZY: [string, string][] = [
    ['the keys.ts env adapter', 'const denoEnv: EnvPort = { get: (name) => Deno.env.get(name) };'],
    ['a function declaration', "export function read() {\n  return Deno.env.get('K');\n}"],
    ['an arrow accessor', "export const read = () => Deno.env.get('K');"],
    ['a commented-out read', "// const x = Deno.env.get('K');"],
    ['a type alias', 'export type Reader = (n: string) => string | undefined;'],
    [
      'a handler body',
      "Deno.serve((req) => {\n  const k = Deno.env.get('K');\n  return new Response(k);\n});",
    ],
    [
      'a declaration whose return type wraps to a bare > in column 0',
      "export async function requireUser(\n  req: Request,\n): Promise<\n  { ok: true } | { ok: false }\n> {\n  return { ok: true, k: Deno.env.get('K') };\n}",
    ],
  ];
  for (const [what, src] of EAGER) {
    assert(moduleScopeIo(src).length > 0, `expected a hit for ${what}: ${JSON.stringify(src)}`);
  }
  for (const [what, src] of LAZY) {
    assertEquals(moduleScopeIo(src), [], `expected no hit for ${what}: ${JSON.stringify(src)}`);
  }
});

Deno.test('no internal function performs I/O before its gate', () => {
  // The other half of rule 8's gate-first requirement (issue #271, was #140): body parse is
  // covered above; this covers env reads, outbound fetches and the service-role client. The
  // rule as practised is "before any I/O, env read, or body parse", not "literally the first
  // statement" — a CORS/method preamble that touches nothing but the request object and
  // returns a static response is harmless and stays legal (media-process answers OPTIONS and
  // 405 ahead of its gate; erasure-job, gdpr-export-job and moderation-enforce have no
  // preamble at all). What must NOT be reachable unauthenticated is anything observable:
  // an env read, a network call, or a client construction. Module scope counts — an
  // import-time supabaseAdmin() would run before the gate on every unauthenticated probe.
  for (const [name, posture] of Object.entries(POSTURE)) {
    if (posture !== 'internal') continue;
    const dir = new URL(`../${name}/`, import.meta.url);
    const src = Deno.readTextFileSync(new URL('index.ts', dir));
    const gate = src.indexOf('requireServiceRole(req)');
    assert(gate > -1, `${name} is internal but never calls requireServiceRole`);
    for (const re of IO_CALL) {
      const io = src.search(re);
      assert(
        io === -1 || gate < io,
        `${name} performs I/O (${re.source}) before its service-role gate`,
      );
    }

    // The check above reads index.ts, because that is where the gate is. But "module scope
    // counts" reaches further than index.ts: index.ts imports its siblings, so a sibling's
    // module-scope env read or fetch runs at import time — before the gate, on every
    // unauthenticated probe — and the ordering check above would stay green (erasure-job/kv.ts
    // was the first sibling to hold a Deno.env.get, #515). Inside a function body those calls
    // are fine: they only run once the handler has already passed the gate.
    //
    // SCOPE: the function's OWN directory. _shared/ is a sibling by import too, and is covered
    // by the test below — which could not be written until #541 lifted the one violation that
    // would have failed it.
    const siblings = [...Deno.readDirSync(dir)]
      .filter((e) => e.isFile && e.name.endsWith('.ts') && !e.name.endsWith('.test.ts'))
      .filter((e) => e.name !== 'index.ts');
    for (const e of siblings) {
      const hits = moduleScopeIo(Deno.readTextFileSync(new URL(e.name, dir)));
      assert(
        hits.length === 0,
        `${name}/${e.name}:${hits.join('; ')} at module scope — it would run at import time, before ${name}'s service-role gate`,
      );
    }
  }
});

Deno.test('no _shared module performs I/O at module scope', () => {
  // _shared/ is a sibling by import to EVERY function, the internal ones included, so a
  // module-scope env read, fetch or service-role client there runs at import time — ahead of
  // requireServiceRole, on the isolate's cold start. The per-function scan above stops at the
  // function's own directory; this is its other half.
  //
  // It could not be written before #541: _shared/stripe.ts built its Stripe client from
  // Deno.env.get('STRIPE_SECRET_KEY') at module scope and release-fund-payout imports it, so
  // this test would have failed on the tree that would have introduced it, and the guard
  // carried a written exemption instead. The exemption is gone — do not add another. Lazy
  // accessors are what this module family uses instead (keys.ts, stripe.ts).
  // stripe-webhook/index.ts does resolve its Stripe client eagerly, on purpose and with its
  // reason in a comment, but that is a webhook-posture index.ts and not a _shared module.
  const dir = new URL('./', import.meta.url);
  const files = [...Deno.readDirSync(dir)]
    .filter((e) => e.isFile && e.name.endsWith('.ts') && !e.name.endsWith('.test.ts'))
    .map((e) => e.name)
    .sort();
  // A scanner that finds nothing must first prove it looked at something (secret-exposure.test.ts
  // learned this the expensive way, #271).
  assert(files.length >= 8, `_shared scan found only ${files.length} non-test modules`);
  for (const name of files) {
    const hits = moduleScopeIo(Deno.readTextFileSync(new URL(name, dir)));
    assert(
      hits.length === 0,
      `_shared/${name}:${hits.join('; ')} at module scope — it runs at import time, ahead of every function's gate`,
    );
  }
});

Deno.test('every user-callable function calls requireUser', () => {
  for (const [name, posture] of Object.entries(POSTURE)) {
    if (posture !== 'user') continue;
    const src = Deno.readTextFileSync(new URL(`../${name}/index.ts`, import.meta.url));
    assert(
      src.includes('requireUser(req)'),
      `${name} is user-callable but never calls requireUser`,
    );
  }
});
