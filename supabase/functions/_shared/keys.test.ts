// Run via `cd supabase/functions && deno test --allow-env .` (CI edge job).
// Every case injects an EnvPort rather than mutating Deno.env, so these tests say nothing
// about which keys the machine happens to have.
import { assert, assertEquals, assertThrows } from 'jsr:@std/assert@1';
import { type EnvPort, parseKeyMap, publishableKey, secretKey, secretKeys } from './keys.ts';

const env = (vars: Record<string, string>): EnvPort => ({ get: (n) => vars[n] });

const SECRET_A = 'sb_secret_aaaaaaaaaaaaaaaaaaaa';
const SECRET_B = 'sb_secret_bbbbbbbbbbbbbbbbbbbb';
const LEGACY_SERVICE = 'eyJhbGciOiJIUzI1NiJ9.service';
const PUBLISHABLE = 'sb_publishable_cccccccccccc';
const LEGACY_ANON = 'eyJhbGciOiJIUzI1NiJ9.anon';

// ── parseKeyMap ──────────────────────────────────────────────────────────────

Deno.test('parseKeyMap reads a name-keyed dictionary', () => {
  assertEquals(parseKeyMap(`{"default":"${SECRET_A}"}`), { default: SECRET_A });
});

Deno.test('parseKeyMap returns {} for anything that is not a string dictionary', () => {
  // The platform injects these; a malformed value must degrade to the legacy fallback
  // rather than take every edge function down at import time.
  for (const raw of [undefined, null, '', '   ', 'null', '[]', '"str"', '7', 'not json']) {
    assertEquals(parseKeyMap(raw), {}, `expected {} for ${JSON.stringify(raw)}`);
  }
  // non-string members are dropped individually, not fatally
  assertEquals(parseKeyMap('{"a":"k","b":3,"c":null}'), { a: 'k' });
});

// ── secretKeys ───────────────────────────────────────────────────────────────

Deno.test('secretKeys puts `default` first, then the remaining names sorted', () => {
  assertEquals(
    secretKeys(env({ SUPABASE_SECRET_KEYS: `{"zeta":"z","default":"${SECRET_A}","alpha":"a"}` })),
    [SECRET_A, 'a', 'z'],
  );
});

Deno.test('secretKeys falls back to the legacy service-role key', () => {
  assertEquals(secretKeys(env({ SUPABASE_SERVICE_ROLE_KEY: LEGACY_SERVICE })), [LEGACY_SERVICE]);
});

Deno.test('secretKeys keeps the legacy key last so new keys win', () => {
  // Ordering matters: secretKey() takes [0], and onward service-to-service calls should
  // present the new key even while the legacy one is still accepted.
  assertEquals(
    secretKeys(
      env({
        SUPABASE_SECRET_KEYS: `{"default":"${SECRET_A}"}`,
        SUPABASE_SERVICE_ROLE_KEY: LEGACY_SERVICE,
      }),
    ),
    [SECRET_A, LEGACY_SERVICE],
  );
});

Deno.test('secretKeys never lists the same key twice', () => {
  assertEquals(
    secretKeys(
      env({
        SUPABASE_SECRET_KEYS: `{"default":"${SECRET_A}","copy":"${SECRET_A}"}`,
        SUPABASE_SERVICE_ROLE_KEY: SECRET_A,
      }),
    ),
    [SECRET_A],
  );
});

Deno.test('secretKeys returns [] when the platform injected nothing', () => {
  assertEquals(secretKeys(env({})), []);
  // and blanks are not keys
  assertEquals(secretKeys(env({ SUPABASE_SERVICE_ROLE_KEY: '  ' })), []);
});

Deno.test('secretKey throws a named error rather than handing back undefined', () => {
  assertEquals(secretKey(env({ SUPABASE_SECRET_KEYS: `{"default":"${SECRET_B}"}` })), SECRET_B);
  assertThrows(() => secretKey(env({})), Error, 'SUPABASE_SECRET_KEYS');
});

// ── publishableKey ───────────────────────────────────────────────────────────

Deno.test('publishableKey prefers `default`, then a lone entry, then sorted-first', () => {
  assertEquals(
    publishableKey(env({ SUPABASE_PUBLISHABLE_KEYS: `{"x":"other","default":"${PUBLISHABLE}"}` })),
    PUBLISHABLE,
  );
  assertEquals(
    publishableKey(env({ SUPABASE_PUBLISHABLE_KEYS: `{"only":"${PUBLISHABLE}"}` })),
    PUBLISHABLE,
  );
  assertEquals(
    publishableKey(env({ SUPABASE_PUBLISHABLE_KEYS: '{"b":"second","a":"first"}' })),
    'first',
  );
});

Deno.test('publishableKey falls back to the legacy anon key', () => {
  assertEquals(publishableKey(env({ SUPABASE_ANON_KEY: LEGACY_ANON })), LEGACY_ANON);
});

Deno.test('publishableKey throws naming both variables when neither is injected', () => {
  const err = assertThrows(() => publishableKey(env({})), Error);
  assert(err.message.includes('SUPABASE_PUBLISHABLE_KEYS'));
  assert(err.message.includes('SUPABASE_ANON_KEY'));
});
