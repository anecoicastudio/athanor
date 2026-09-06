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
import { assert, assertEquals, assertRejects, assertThrows } from 'jsr:@std/assert@1';
import type Stripe from 'npm:stripe@22';
import type { EnvPort } from './keys.ts';
import {
  circlePriceIds,
  cryptoProvider,
  STRIPE_API_VERSION,
  stripeClient,
  verifyWithAnySecret,
  webhookSigningSecrets,
} from './stripe.ts';

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

Deno.test('stripeClient reads STRIPE_SECRET_KEY once per port, and nothing else', () => {
  // What a test inside this module can actually hold it to: exactly one variable is read, and
  // the memo means the second call reads nothing at all. That the IMPORT reads nothing is the
  // property #541 is really about, and this file cannot observe it — by the time a case runs,
  // the import has already happened. config-invariants.test.ts asserts that half on the source.
  const seen: string[] = [];
  const port: EnvPort = {
    get: (n) => {
      seen.push(n);
      return n === 'STRIPE_SECRET_KEY' ? SECRET : undefined;
    },
  };
  stripeClient(port);
  assertEquals(seen, ['STRIPE_SECRET_KEY']);
  stripeClient(port);
  assertEquals(seen, ['STRIPE_SECRET_KEY'], 'the memo must not re-read the env');
});

Deno.test('cryptoProvider is built once', () => {
  // Reads no env, so it was never a rule-8 problem — it is lazy so that "this module does no
  // work at import time" holds with no exception to remember.
  assert(cryptoProvider() === cryptoProvider());
});

// ── circlePriceIds (#674 item 9) ─────────────────────────────────────────────

Deno.test('circlePriceIds reads the two STRIPE_PRICE_CIRCLE_* names, and nothing else', () => {
  // The names are the contract: RELEASE-RUNBOOK §4.2 sets exactly these two at cutover, and
  // both functions now resolve them here, so a rename is one edit and one test.
  const seen: string[] = [];
  const port: EnvPort = {
    get: (n) => {
      seen.push(n);
      return { STRIPE_PRICE_CIRCLE_MONTHLY: 'price_m', STRIPE_PRICE_CIRCLE_ANNUAL: 'price_a' }[n];
    },
  };
  assertEquals(circlePriceIds(port), { monthly: 'price_m', annual: 'price_a' });
  assertEquals(seen.sort(), ['STRIPE_PRICE_CIRCLE_ANNUAL', 'STRIPE_PRICE_CIRCLE_MONTHLY']);
});

Deno.test('circlePriceIds treats a blank value as unset', () => {
  // A declared-but-empty secret must read as «not configured», never as an empty id that
  // reaches `prices.retrieve` and fails as a Stripe error the operator reads the wrong way.
  assertEquals(circlePriceIds(env({ STRIPE_PRICE_CIRCLE_MONTHLY: '   ' })), {
    monthly: undefined,
    annual: undefined,
  });
  assertEquals(circlePriceIds(env({})), { monthly: undefined, annual: undefined });
});

// ── webhook signing secrets: two scopes, one endpoint URL (#702) ─────────────

// Not whsec-shaped, for the same reason SECRET above is not key-shaped: secret-exposure.test.ts
// fails on any /\bwhsec_[A-Za-z0-9]/ literal in source, and it is right to. The HMAC is over a
// UTF-8 string — the `whsec_` prefix is Dashboard convention and carries no meaning here.
const PLATFORM_SECRET = 'signing-secret-your-account';
const CONNECT_SECRET = 'signing-secret-connected-accounts';

Deno.test('webhookSigningSecrets reads the two signing-secret names, and nothing else', () => {
  // The names are the contract: RELEASE-RUNBOOK §4.2 sets exactly these two at cutover, one per
  // Dashboard endpoint scope, and index.ts resolves them here.
  const seen: string[] = [];
  const port: EnvPort = {
    get: (n) => {
      seen.push(n);
      return {
        STRIPE_WEBHOOK_SECRET: PLATFORM_SECRET,
        STRIPE_CONNECT_WEBHOOK_SECRET: CONNECT_SECRET,
      }[n];
    },
  };
  assertEquals(webhookSigningSecrets(port), {
    platform: PLATFORM_SECRET,
    connect: CONNECT_SECRET,
  });
  assertEquals(seen.sort(), ['STRIPE_CONNECT_WEBHOOK_SECRET', 'STRIPE_WEBHOOK_SECRET']);
});

Deno.test(
  'webhookSigningSecrets treats a blank value as unset, and each half independently',
  () => {
    // A declared-but-empty secret is what an un-provisioned one looks like on a hosted project.
    // Independence is the point: production carried an unset STRIPE_WEBHOOK_SECRET on purpose
    // (RELEASE-RUNBOOK §4.2), and the Connect secret arrives later still.
    assertEquals(webhookSigningSecrets(env({ STRIPE_WEBHOOK_SECRET: '   ' })), {
      platform: undefined,
      connect: undefined,
    });
    assertEquals(webhookSigningSecrets(env({ STRIPE_CONNECT_WEBHOOK_SECRET: CONNECT_SECRET })), {
      platform: undefined,
      connect: CONNECT_SECRET,
    });
    assertEquals(webhookSigningSecrets(env({})), { platform: undefined, connect: undefined });
  },
);

// ── verifyWithAnySecret: the either-or, as a pure function ───────────────────

/** A verifier that accepts exactly one secret, recording what it was offered. */
const acceptsOnly = (good: string, tried: string[] = []) => ({
  tried,
  verify: (secret: string): Promise<Stripe.Event> => {
    tried.push(secret);
    return secret === good
      ? Promise.resolve({ id: 'evt_1' } as unknown as Stripe.Event)
      : Promise.reject(new Error(`no signatures found matching, secret ${secret}`));
  },
});

Deno.test('verifyWithAnySecret returns on the platform secret without trying the second', () => {
  // Platform events are the overwhelming majority, so they must cost exactly one HMAC.
  const { tried, verify } = acceptsOnly(PLATFORM_SECRET);
  return verifyWithAnySecret(verify, [PLATFORM_SECRET, CONNECT_SECRET]).then((event) => {
    assertEquals(event.id, 'evt_1');
    assertEquals(tried, [PLATFORM_SECRET], 'the Connect secret must not be tried after a match');
  });
});

Deno.test('verifyWithAnySecret falls through to the Connect secret', async () => {
  // The #702 case: a connected account's account.updated, signed by the «Connected accounts»
  // endpoint's own secret, arriving at the same URL the platform endpoint posts to.
  const { tried, verify } = acceptsOnly(CONNECT_SECRET);
  const event = await verifyWithAnySecret(verify, [PLATFORM_SECRET, CONNECT_SECRET]);
  assertEquals(event.id, 'evt_1');
  assertEquals(tried, [PLATFORM_SECRET, CONNECT_SECRET]);
});

Deno.test(
  'verifyWithAnySecret rethrows the FIRST failure when neither secret matches',
  async () => {
    // Forgery, or a stale secret. The platform secret's error is rethrown because it is the one an
    // operator is almost always debugging; handleWebhook turns any throw into «bad signature» 400.
    const { tried, verify } = acceptsOnly('neither-of-them');
    const err = await assertRejects(
      () => verifyWithAnySecret(verify, [PLATFORM_SECRET, CONNECT_SECRET]),
      Error,
    );
    assertEquals(tried, [PLATFORM_SECRET, CONNECT_SECRET], 'every secret must be tried');
    assert(err.message.includes(PLATFORM_SECRET), `first failure expected, got: ${err.message}`);
  },
);

Deno.test('verifyWithAnySecret skips unset and blank secrets rather than trying them', async () => {
  // An absent Connect secret must cost the platform arms nothing — this is what makes the
  // variable deploy-deferrable instead of boot-fatal.
  const { tried, verify } = acceptsOnly(PLATFORM_SECRET);
  await verifyWithAnySecret(verify, [PLATFORM_SECRET, undefined, '']);
  assertEquals(tried, [PLATFORM_SECRET]);
});

Deno.test('verifyWithAnySecret names the failure when NO secret is configured', async () => {
  // Named for a reader holding a stack trace, NOT for the operator: this throw lands in
  // handleWebhook's bare catch, which answers 400 and logs nothing. index.ts's cold-start warn is
  // what says a variable is missing. Asserting the names still pins them against a rename.
  const { tried, verify } = acceptsOnly(PLATFORM_SECRET);
  const err = await assertRejects(() => verifyWithAnySecret(verify, [undefined, '  ']), Error);
  assertEquals(tried, [], 'nothing to try means nothing is called');
  assert(err.message.includes('STRIPE_WEBHOOK_SECRET'), err.message);
  assert(err.message.includes('STRIPE_CONNECT_WEBHOOK_SECRET'), err.message);
});

// ── end to end over a REAL Stripe signature ──────────────────────────────────

/**
 * The wiring index.ts builds, rebuilt here. No test imports an index.ts (they call Deno.serve),
 * so this is the closest a test gets to the deployed seam: a genuine `stripe-signature` header
 * over genuine bytes, verified by the real SDK through the real Web Crypto provider.
 *
 * `generateTestHeaderStringAsync`, never the sync form — SubtleCryptoProvider is async-only and
 * the sync one throws under Deno.
 */
const signedDelivery = async (payload: string, secret: string) => {
  const stripe = stripeClient(env({ STRIPE_SECRET_KEY: SECRET }));
  const stripeCrypto = cryptoProvider();
  const sig = await stripe.webhooks.generateTestHeaderStringAsync({
    payload,
    secret,
    cryptoProvider: stripeCrypto,
  });
  return {
    sig,
    verifyEvent: (raw: string, header: string) =>
      verifyWithAnySecret(
        (s) => stripe.webhooks.constructEventAsync(raw, header, s, undefined, stripeCrypto),
        [PLATFORM_SECRET, CONNECT_SECRET],
      ),
  };
};

Deno.test('a platform-signed delivery still verifies once a second secret exists', async () => {
  // The regression this change must not cause: every arm but W13 rides the platform endpoint.
  const payload = JSON.stringify({ id: 'evt_platform', type: 'charge.refunded', data: {} });
  const { sig, verifyEvent } = await signedDelivery(payload, PLATFORM_SECRET);
  const event = await verifyEvent(payload, sig);
  assertEquals(event.id, 'evt_platform');
});

Deno.test('a Connect-signed account.updated verifies and carries its account id', async () => {
  // #702 itself. The top-level `account` is what marks a connected-account delivery, and it is
  // readable only AFTER verification — which is exactly why the secret cannot be chosen by
  // inspecting the payload.
  const payload = JSON.stringify({
    id: 'evt_connect',
    type: 'account.updated',
    account: 'acct_connected',
    data: { object: { id: 'acct_connected', payouts_enabled: true } },
  });
  const { sig, verifyEvent } = await signedDelivery(payload, CONNECT_SECRET);
  const event = await verifyEvent(payload, sig);
  assertEquals(event.id, 'evt_connect');
  assertEquals(event.account, 'acct_connected');
});

Deno.test('a delivery signed by neither secret is rejected', async () => {
  // Forgery, or a Dashboard endpoint whose secret was rotated without setting the variable.
  const payload = JSON.stringify({ id: 'evt_forged', type: 'account.updated', data: {} });
  const { sig } = await signedDelivery(payload, 'a-third-secret-nobody-configured');
  const { verifyEvent } = await signedDelivery(payload, PLATFORM_SECRET);
  await assertRejects(() => verifyEvent(payload, sig), Error);
});

Deno.test('a tampered body no longer matches its own signature', async () => {
  // The property the whole gate exists for: the signature is over the exact received bytes.
  const payload = JSON.stringify({ id: 'evt_1', type: 'account.updated', data: {} });
  const { sig, verifyEvent } = await signedDelivery(payload, CONNECT_SECRET);
  await assertRejects(() => verifyEvent(payload.replace('evt_1', 'evt_2'), sig), Error);
});
