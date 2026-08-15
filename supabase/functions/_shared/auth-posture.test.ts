// deno test supabase/functions/create-verification-session/ — runs in CI (edge job) and locally.
// Needs --allow-read (already in the documented run command).
//
// SPEC-FIRST. CLAUDE.md rule 8: "Edge functions are the only privileged surface." Every function
// declares exactly one of three auth postures in supabase/config.toml — user-callable
// (verify_jwt = true AND requireUser(req) first), internal service-role (verify_jwt = false, with
// requireServiceRole(req) as the ONLY gate, first, before any I/O), or webhook (verify_jwt =
// false, authenticity from the Stripe signature + the stripe_webhook_events dedupe). The rule
// also fixes that "`profile_id` is always derived from getUser(), never taken from the request
// body". These tests cover the whole user-callable family, which is posture one.
// docs/PRD.md:225 makes Identity the gate for creating paid
// events and candidating a dream, so a spoofable profile_id here is not a nuisance — it verifies
// the wrong person and unlocks the paid surfaces for them.
//
// _shared/config-invariants.test.ts already covers the config leg (verify_jwt = true and
// requireUser present for every user-callable function) and the uniform gate-before-parse
// ordering. These tests go deeper for the whole user-callable family: identity must not be
// readable out of the request body at all, and the service-role client stays out of reach.
//
// Discovery comes from the POSTURE table, not a filename prefix (issue #271, was #141): the
// old `create-` filter silently exempted check-in — the one user-callable function that
// deliberately holds an admin client — from every rule in this file.
import { assert } from 'jsr:@std/assert@1';
import { POSTURE } from './config-invariants.test.ts';

const USER_FNS = Object.entries(POSTURE)
  .filter(([, posture]) => posture === 'user')
  .map(([name]) => name)
  .sort();

const src = (fn: string, file = 'index.ts') =>
  Deno.readTextFileSync(new URL(`../${fn}/${file}`, import.meta.url));

Deno.test('every user-callable function is discovered', () => {
  // Guards the guard: an emptied POSTURE table would make the rest vacuously green, and
  // check-in is named because its absence is exactly how it escaped for two months.
  assert(
    USER_FNS.length >= 6,
    `expected the user-callable family, got ${JSON.stringify(USER_FNS)}`,
  );
  assert(USER_FNS.includes('create-verification-session'));
  assert(USER_FNS.includes('check-in'));
});

Deno.test('requireUser gates every user-callable function BEFORE the body is parsed', () => {
  // A gate after `await req.json()` still lets an unauthenticated caller drive parsing, and —
  // worse for this family — makes it syntactically easy to reach for a body field as identity
  // because the body is already in scope. Same rule config-invariants applies uniformly,
  // kept here too so this file stands alone on the money surface.
  const BODY_READ = /\breq\.(json|text|formData|arrayBuffer)\s*\(/;
  for (const fn of USER_FNS) {
    const code = src(fn);
    const gate = code.indexOf('requireUser(req)');
    assert(gate > -1, `${fn}: no requireUser(req)`);
    const parse = code.search(BODY_READ);
    assert(parse === -1 || gate < parse, `${fn}: parses the request body before requireUser`);
  }
});

Deno.test('no user-callable function can read an identity out of the request body', () => {
  // The rule-8 failure that costs money: `const { profile_id } = await req.json()` lets anyone
  // with a valid JWT mint a Checkout session, a subscription, or an Identity verification
  // *as somebody else*.
  //
  // Scoped to index.ts: that is the only file holding a Request. logic.ts receives an already
  // derived args object (`input`), so a `profileId` destructured there is the SAFE shape, not
  // the unsafe one — an earlier revision of this test flagged create-circle-checkout's
  // `const { profileId, email, plan } = input` and was wrong to.
  const BODY_IDENTITY = [
    /\b(body|payload|json|parsed)\s*\.\s*(profile_?[iI]d|user_?[iI]d)\b/,
    /\b(body|payload|json|parsed)\s*\[\s*['"](profile_id|profileId|user_id|userId)['"]/,
    /const\s*\{[^}]*\b(profile_?[iI]d|user_?[iI]d)\b[^}]*\}\s*=\s*(await\s+)?(req\.json\(\)|body|payload|json|parsed)\b/,
  ];
  for (const fn of USER_FNS) {
    const code = src(fn);
    for (const re of BODY_IDENTITY) {
      const m = code.match(re);
      assert(!m, `${fn}/index.ts: identity taken from the request body — "${m?.[0]}"`);
    }
  }
});

// The deliberate exceptions to the no-service-role rule, each by name and with its reason
// (issue #271, was #141) — the other two tests in this file apply to both in full, and
// identity still comes from the JWT (requireUser), never the body:
// - check-in: an organiser scanning a ticket cannot read another member's event_attendance
//   row under RLS — 20260616022242_event_attendance_revoke_client_mutations blocks the client
//   path on purpose — so its logic verifies the QR against the ticket row through an admin
//   client.
// - create-payout-onboarding: payout_accounts is SRW (#245 — revoke all, grant back SELECT
//   only), so the initial {profile_id, stripe_account_id} pointer row cannot ride the
//   caller's RLS; the insert goes through the admin client. Capability flags stay the
//   webhook's job — this function writes nothing else.
const SERVICE_ROLE_ALLOWED = new Set(['check-in', 'create-payout-onboarding']);

Deno.test('no user-callable function reaches for the service-role client', () => {
  // Rule 8 confines the service-role key to _shared/supabaseAdmin.ts and server jobs. These are
  // user-callable, so they must run under the caller's RLS — every one of them already takes a
  // `userClient` capability (see the four logic.test.ts ctx builders). An admin client here
  // would silently read rows the caller cannot see and price a Checkout session from them.
  for (const fn of SERVICE_ROLE_ALLOWED) {
    assert(
      POSTURE[fn] === 'user',
      `${fn} is allowlisted for the service role as a user-callable function, but its posture is '${POSTURE[fn]}'`,
    );
  }
  for (const fn of USER_FNS) {
    if (SERVICE_ROLE_ALLOWED.has(fn)) continue;
    for (const file of ['index.ts', 'logic.ts']) {
      const code = src(fn, file);
      assert(
        !/supabaseAdmin|SERVICE_ROLE/.test(code),
        `${fn}/${file}: user-callable function reaches for the service role`,
      );
    }
  }
});
