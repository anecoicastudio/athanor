// Run via `cd supabase/functions && deno test --allow-env .` (CI edge job).
// requireServiceRole takes an injectable EnvPort, so these cases describe key shapes rather
// than whatever the machine happens to have in its environment.
import { assert, assertEquals } from 'jsr:@std/assert@1';
import { requireServiceRole, timingSafeEqual } from './auth.ts';
import type { EnvPort } from './keys.ts';

const SECRET = 'sb_secret_aaaaaaaaaaaaaaaaaaaa';
const NAMED = 'sb_secret_bbbbbbbbbbbbbbbbbbbb';
const LEGACY = 'eyJhbGciOiJIUzI1NiJ9.legacy-service-role';
const PUBLISHABLE = 'sb_publishable_cccccccccccc';

const env = (vars: Record<string, string>): EnvPort => ({ get: (n) => vars[n] });

const NEW_KEYS = env({
  SUPABASE_SECRET_KEYS: `{"default":"${SECRET}","internal-callers":"${NAMED}"}`,
});
const BOTH_FAMILIES = env({
  SUPABASE_SECRET_KEYS: `{"default":"${SECRET}"}`,
  SUPABASE_SERVICE_ROLE_KEY: LEGACY,
});

const req = (headers: Record<string, string | undefined>) => {
  const h = new Headers();
  for (const [name, value] of Object.entries(headers)) if (value !== undefined) h.set(name, value);
  return new Request('http://localhost/fn', { method: 'POST', headers: h });
};

Deno.test('timingSafeEqual: equal, unequal, differing lengths, empty', () => {
  assert(timingSafeEqual('abc', 'abc'));
  assert(timingSafeEqual('', ''));
  assert(!timingSafeEqual('abc', 'abd'));
  assert(!timingSafeEqual('abc', 'ab'));
  assert(!timingSafeEqual('abc', 'abcd'));
  assert(!timingSafeEqual('', 'a'));
});

// ── the accepted shapes ──────────────────────────────────────────────────────

Deno.test('requireServiceRole: secret key on the apikey header → ok', () => {
  // apikey is where new-style keys BELONG: the platform tries to parse an Authorization
  // bearer as a JWT, and a secret key is not a JWT, so it would be rejected upstream.
  const gate = requireServiceRole(req({ apikey: SECRET }), NEW_KEYS);
  assert(gate.ok);
});

Deno.test('requireServiceRole: a non-default named secret key is accepted too', () => {
  // This is what makes key rotation a dashboard-only operation with no 401 window.
  const gate = requireServiceRole(req({ apikey: NAMED }), NEW_KEYS);
  assert(gate.ok);
});

Deno.test('requireServiceRole: legacy service-role key on Authorization still works', () => {
  // Back-compat both ways round: the SQL callers can move to `apikey` before or after this
  // deploys, in either order, without a broken window.
  const gate = requireServiceRole(req({ Authorization: `Bearer ${LEGACY}` }), BOTH_FAMILIES);
  assert(gate.ok);
});

Deno.test('requireServiceRole: a bare Authorization value without "Bearer " is accepted', () => {
  const gate = requireServiceRole(req({ Authorization: SECRET }), NEW_KEYS);
  assert(gate.ok);
});

Deno.test('requireServiceRole: apikey wins over a wrong Authorization', () => {
  const gate = requireServiceRole(
    req({ apikey: SECRET, Authorization: 'Bearer nonsense' }),
    NEW_KEYS,
  );
  assert(gate.ok);
});

Deno.test('requireServiceRole: hands back the function OWN key, not the presented one', () => {
  // Onward service-to-service calls must not replay whatever the caller happened to send —
  // that is a confused deputy, and it also breaks the moment the caller rotates.
  const gate = requireServiceRole(req({ apikey: NAMED }), NEW_KEYS);
  assert(gate.ok);
  if (gate.ok) assertEquals(gate.secretKey, SECRET); // secretKeys()[0] = `default`, not NAMED
});

// ── the rejected shapes ──────────────────────────────────────────────────────

Deno.test('requireServiceRole: a publishable key is not a secret key → 401', () => {
  const gate = requireServiceRole(req({ apikey: PUBLISHABLE }), NEW_KEYS);
  assert(!gate.ok);
  if (!gate.ok) assertEquals(gate.response.status, 401);
});

Deno.test('requireServiceRole: no credential at all → 401', () => {
  for (const headers of [{}, { apikey: '' }, { Authorization: 'Bearer ' }]) {
    const gate = requireServiceRole(req(headers), NEW_KEYS);
    assert(!gate.ok, `expected 401 for ${JSON.stringify(headers)}`);
  }
});

Deno.test('requireServiceRole: no keys injected → 401 for every input', () => {
  // Never match the empty string. With verify_jwt=false on the internal functions this gate
  // is the ONLY thing between the open internet and a service-role client.
  for (const headers of [{}, { apikey: '' }, { apikey: SECRET }, { Authorization: 'Bearer x' }]) {
    const gate = requireServiceRole(req(headers), env({}));
    assert(!gate.ok, `expected 401 for ${JSON.stringify(headers)}`);
    if (!gate.ok) assertEquals(gate.response.status, 401);
  }
});
