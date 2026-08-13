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
  'check-in': 'user',
  'create-circle-checkout': 'user',
  'create-circle-portal': 'user',
  'create-contribution-session': 'user',
  'create-ticket-checkout': 'user',
  'create-verification-session': 'user',
  'erasure-job': 'internal',
  'gdpr-export-job': 'internal',
  'media-process': 'internal',
  'moderation-enforce': 'internal',
  'notification-fan-out': 'internal',
  'push-dispatch': 'internal',
  'score-engine': 'internal',
  'stripe-webhook': 'webhook',
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
  const IO_CALL = [/\bDeno\.env\.get\s*\(/, /\bfetch\s*\(/, /\bsupabaseAdmin\s*\(/];
  for (const [name, posture] of Object.entries(POSTURE)) {
    if (posture !== 'internal') continue;
    const src = Deno.readTextFileSync(new URL(`../${name}/index.ts`, import.meta.url));
    const gate = src.indexOf('requireServiceRole(req)');
    assert(gate > -1, `${name} is internal but never calls requireServiceRole`);
    for (const re of IO_CALL) {
      const io = src.search(re);
      assert(
        io === -1 || gate < io,
        `${name} performs I/O (${re.source}) before its service-role gate`,
      );
    }
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
