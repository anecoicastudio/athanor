// deno test supabase/functions/create-verification-session/ — runs in CI (edge job) and locally.
// Characterization tests for the Identity session params + failure shapes. Stripe is injected
// as a capability closure (DI over mocks); no db I/O in this function.
import { assertEquals } from 'jsr:@std/assert@1';
// stripe pinned to major 22: deno.lock is gitignored, so CI resolves fresh on every
// run — an unpinned specifier would typecheck against latest and redden on SDK majors.
import type Stripe from 'npm:stripe@22';
import type { StripeErrorFacts } from '../_shared/stripe-error.ts';
import {
  buildVerificationSessionParams,
  createVerificationSession,
  stripeReturnUrl,
  VERIFICATION_FAILED,
  VERIFICATION_UNAVAILABLE,
  type VerificationSessionCtx,
} from './logic.ts';

const PROFILE = 'prof-1';

type Ctx = VerificationSessionCtx & {
  created: Stripe.Identity.VerificationSessionCreateParams[];
  logged: Array<[string, StripeErrorFacts]>;
};

/** Shaped like a stripe-node StripeError. `statusCode` is what sorts the failure class. */
const stripeError = (statusCode: number, over: Record<string, unknown> = {}) =>
  Object.assign(new Error('stripe refused'), {
    type: 'StripeInvalidRequestError',
    rawType: 'invalid_request_error',
    statusCode,
    requestId: 'req_416',
    ...over,
  });

const ctx = (opts: { throwOnCreate?: unknown; url?: string | null } = {}): Ctx => {
  const created: Stripe.Identity.VerificationSessionCreateParams[] = [];
  const logged: Array<[string, StripeErrorFacts]> = [];
  return {
    createVerificationSession: (params) => {
      created.push(params);
      if (opts.throwOnCreate !== undefined) return Promise.reject(opts.throwOnCreate);
      return Promise.resolve({
        id: 'vs_1',
        url: opts.url === undefined ? 'https://verify.stripe.test/vs_1' : opts.url,
      } as Stripe.Identity.VerificationSession);
    },
    appBase: 'athanor://',
    logFailure: (op, facts) => logged.push([op, facts]),
    created,
    logged,
  };
};

const run = async (c: Ctx, profileId = PROFILE) => {
  const res = await createVerificationSession(c, { profileId });
  return { res, body: await res.json() };
};

Deno.test('happy path → { url } and a document-type session for the caller', async () => {
  const c = ctx();
  const { res, body } = await run(c);
  assertEquals(res.status, 200);
  assertEquals(body, { url: 'https://verify.stripe.test/vs_1' });
  assertEquals(c.created, [{ type: 'document', metadata: { profile_id: PROFILE } }]);
});

Deno.test('profile_id comes from the verified caller, never from a request body', async () => {
  // requireUser → getUser() is the only source of identity (rule #8). The params builder has
  // no other input, so a body-supplied profile_id has nowhere to enter.
  const c = ctx();
  await run(c, 'someone-else');
  assertEquals(c.created[0].metadata, { profile_id: 'someone-else' });
  assertEquals(Object.keys(c.created[0]).sort(), ['metadata', 'type']);
});

Deno.test('#416: a deep-link scheme is never sent as return_url — Stripe 400s on it', async () => {
  // This is what actually broke every verification start: Stripe replied 400 url_invalid on
  // `return_url` ("Not a valid URL") for `athanor://verify?status=complete`, and the bare catch
  // ate the reason. Omitting the param is legal (it is optional) and loses nothing: the flip
  // comes from webhook W9 over realtime, never from the redirect.
  for (const appBase of ['athanor://', 'exp://192.168.0.10:8081/--/', 'athanor:///']) {
    const c = { ...ctx(), appBase };
    await run(c);
    assertEquals('return_url' in c.created[0], false);
  }
});

Deno.test(
  'an http(s) base IS sent — a bounce page needs no code change to take effect',
  async () => {
    for (const appBase of ['https://www.athanor.workers.dev/r/', 'http://localhost:3000/r/']) {
      const c = { ...ctx(), appBase };
      await run(c);
      assertEquals(c.created[0].return_url, `${appBase}verify?status=complete`);
    }
  },
);

Deno.test('stripeReturnUrl judges the whole URL, not the base alone', () => {
  assertEquals(stripeReturnUrl('https://x.test/', 'verify'), 'https://x.test/verify');
  assertEquals(stripeReturnUrl('HTTPS://x.test/', 'verify'), 'HTTPS://x.test/verify');
  assertEquals(stripeReturnUrl('athanor://', 'verify'), undefined);
  assertEquals(stripeReturnUrl('', 'verify'), undefined);
  // not a scheme Stripe would take, and not one we should smuggle past by prefixing
  assertEquals(stripeReturnUrl('javascript:', 'alert(1)'), undefined);
});

Deno.test(
  'a session without a url → 500 rather than a broken redirect, and it says so',
  async () => {
    // Stripe types url as nullable; handing the app a null would surface as a silent no-op tap.
    for (const url of [null, '']) {
      const c = ctx({ url });
      const { res, body } = await run(c);
      assertEquals(res.status, 500);
      assertEquals(body, { error: VERIFICATION_FAILED });
      assertEquals(c.logged.length, 1);
      assertEquals(c.logged[0][1].message, 'session vs_1 has no url');
    }
  },
);

Deno.test('create throw → clean body, never Stripe internals', async () => {
  // The response may not carry a Stripe message: it is the operator's to read in the logs.
  for (const thrown of [stripeError(400), stripeError(500), new Error('socket hang up')]) {
    const c = ctx({ throwOnCreate: thrown });
    const { body } = await run(c);
    assertEquals(Object.keys(body), ['error']);
    assertEquals([VERIFICATION_UNAVAILABLE, VERIFICATION_FAILED].includes(body.error), true);
  }
});

Deno.test('#416: every failure leaves ONE log line naming the Stripe reason', async () => {
  // The defect this fixes: a bare `catch {}` meant no log line existed at all, which is why
  // an unactivated Identity product took a device session to notice.
  const c = ctx({
    throwOnCreate: stripeError(400, { code: 'resource_missing', rawType: 'invalid_request_error' }),
  });
  await run(c);
  assertEquals(c.logged.length, 1);
  const [operation, facts] = c.logged[0];
  assertEquals(operation, 'identity.verificationSessions.create');
  assertEquals(facts.rawType, 'invalid_request_error');
  assertEquals(facts.code, 'resource_missing');
  assertEquals(facts.statusCode, 400);
  assertEquals(facts.requestId, 'req_416');
  assertEquals(facts.message, 'stripe refused');
});

Deno.test(
  'a 4xx is a configuration refusal → 503, distinguishable from a retryable failure',
  async () => {
    // Params carry no caller-supplied value, so Stripe refusing them is our configuration:
    // Identity not activated, a key without the permission, an API-version mismatch. Telling
    // the member to "try again" against any of those would be a lie.
    for (const statusCode of [400, 401, 403, 404]) {
      const c = ctx({ throwOnCreate: stripeError(statusCode) });
      const { res, body } = await run(c);
      assertEquals(res.status, 503);
      assertEquals(body, { error: VERIFICATION_UNAVAILABLE });
    }
  },
);

Deno.test('a rate limit, a Stripe 5xx and a connection failure stay retryable 500s', async () => {
  for (const thrown of [stripeError(429), stripeError(500), stripeError(503), new Error('down')]) {
    const c = ctx({ throwOnCreate: thrown });
    const { res, body } = await run(c);
    assertEquals(res.status, 500);
    assertEquals(body, { error: VERIFICATION_FAILED });
  }
});

Deno.test('the failure strings are the contract the verify sheet maps on', () => {
  // #103 idiom: the `{error}` string is the contract, and it crosses a package boundary —
  // apps/native's VERIFY_ERROR_COPY keys on these exact literals. Changing one here without
  // changing the map there silently re-swallows #416 at the client, logs fixed or not.
  assertEquals(VERIFICATION_UNAVAILABLE, 'verification unavailable');
  assertEquals(VERIFICATION_FAILED, 'could not start verification');
});

Deno.test('buildVerificationSessionParams is pure and deterministic', () => {
  const a = buildVerificationSessionParams(PROFILE, 'athanor://');
  const b = buildVerificationSessionParams(PROFILE, 'athanor://');
  assertEquals(a, b);
  assertEquals(a.type, 'document');
});
