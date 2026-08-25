// Run via `cd supabase/functions && deno test --allow-env --allow-read .` (CI edge job).
//
// #541: this module used to build its Stripe client at module scope, so importing it read
// STRIPE_SECRET_KEY — ahead of release-fund-payout's requireServiceRole gate, which rule 8
// says nothing may precede. Nothing asserted the export shape either way, so the refactor
// away from it could have been silently undone.
//
// Two halves guard it now, and they are deliberately different in kind:
//   • config-invariants.test.ts scans _shared/ source for module-scope I/O. That is the
//     deterministic half — it holds whatever this machine's env contains.
//   • this file asserts the accessor contract the fix depends on: the read happens on call,
//     the failure is named, the client is built once, and a throw is not cached.
// The static import below is itself the third: on CI, where STRIPE_SECRET_KEY is unset, a
// module-scope construction fails to load this file at all.
//
// Every case injects an EnvPort rather than mutating Deno.env, per keys.test.ts — these tests
// say nothing about which secrets the machine happens to hold.
import { assert, assertEquals, assertThrows } from 'jsr:@std/assert@1';
import type { EnvPort } from './keys.ts';
import { cryptoProvider, STRIPE_API_VERSION, stripeClient } from './stripe.ts';

// Not key-shaped on purpose: secret-exposure.test.ts fails on any /\b(sk|rk)_(live|test)_/
// literal in source, and it is right to. The SDK only requires a non-empty string.
const SECRET = 'stripe-secret-for-tests';

const env = (vars: Record<string, string>): EnvPort => ({ get: (n) => vars[n] });

Deno.test('STRIPE_API_VERSION stays pinned', () => {
  // Must match the Dashboard webhook endpoint (08 §4.1) and the stripe@22 SDK pin. Floating it
  // is a deploy-time incident, so moving it has to be a deliberate edit in two places.
  assertEquals(STRIPE_API_VERSION, '2026-05-27.dahlia');
});

Deno.test('stripeClient throws a named error when the secret is absent', () => {
  // The SDK's own message is «Neither apiKey nor config.authenticator provided», which reads
  // like an SDK misuse. In stripe-webhook it would reach the operator as «bad signature».
  assertThrows(() => stripeClient(env({})), Error, 'STRIPE_SECRET_KEY');
});

Deno.test('stripeClient throws on a blank secret, not just a missing one', () => {
  // An empty or whitespace-only value is what an unset-but-declared secret looks like.
  for (const raw of ['', '   ', '\n']) {
    assertThrows(
      () => stripeClient(env({ STRIPE_SECRET_KEY: raw })),
      Error,
      'STRIPE_SECRET_KEY',
      `expected a throw for ${JSON.stringify(raw)}`,
    );
  }
});

Deno.test('stripeClient builds one client per env port and memoizes it', () => {
  // "Same client, same config, memoized" is the behaviour the module-scope version gave every
  // consumer for free; laziness must not turn it into a client per call.
  const port = env({ STRIPE_SECRET_KEY: SECRET });
  const first = stripeClient(port);
  assert(first === stripeClient(port), 'expected the memoized client');
  const other = env({ STRIPE_SECRET_KEY: SECRET });
  assert(first !== stripeClient(other), 'a different env port must build its own client');
});

Deno.test('stripeClient does not cache a failure', () => {
  // A secret set after the isolate booted (or a test fixing its fixture) must recover on the
  // next call. Caching the throw would strand the function until it is redeployed.
  let secret: string | undefined;
  const port: EnvPort = { get: () => secret };
  assertThrows(() => stripeClient(port), Error, 'STRIPE_SECRET_KEY');
  secret = SECRET;
  const client = stripeClient(port);
  assert(client === stripeClient(port), 'expected the recovered client to memoize');
});

Deno.test('stripeClient reads the env on call, never before', () => {
  // The rule-8 property, as behaviour: the port is untouched until stripeClient() is called.
  // Importing this module has already happened by now and must not have consulted anything.
  const seen: string[] = [];
  const port: EnvPort = {
    get: (n) => {
      seen.push(n);
      return n === 'STRIPE_SECRET_KEY' ? SECRET : undefined;
    },
  };
  assertEquals(seen, []);
  stripeClient(port);
  assertEquals(seen, ['STRIPE_SECRET_KEY']);
});

Deno.test('cryptoProvider is built once', () => {
  // Reads no env, so it was never a rule-8 problem — it is lazy so that "this module does no
  // work at import time" holds with no exception to remember.
  assert(cryptoProvider() === cryptoProvider());
});
