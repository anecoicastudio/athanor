// deno test supabase/functions/_shared/ — runs in CI (edge job) and locally.
// The un-swallow (#416): these assert that a Stripe failure survives the catch as readable
// facts, and that the two failure classes sort the way a member can act on.
import { assertEquals } from 'jsr:@std/assert@1';
import {
  describeStripeError,
  logStripeFailure,
  type StripeErrorFacts,
  stripeFailureClass,
} from './stripe-error.ts';

/** Shaped like a stripe-node StripeError — the real one is a class, but nothing here reads it as one. */
const stripeError = (over: Partial<Record<string, unknown>> = {}) =>
  Object.assign(new Error('You cannot create Identity VerificationSessions until you activate…'), {
    type: 'StripeInvalidRequestError',
    rawType: 'invalid_request_error',
    code: 'resource_missing',
    statusCode: 400,
    requestId: 'req_123',
    param: 'type',
    doc_url: 'https://stripe.com/docs/error-codes/resource-missing',
    ...over,
  });

Deno.test('describeStripeError keeps every operator-readable field', () => {
  assertEquals(describeStripeError(stripeError()), {
    type: 'StripeInvalidRequestError',
    rawType: 'invalid_request_error',
    code: 'resource_missing',
    statusCode: 400,
    requestId: 'req_123',
    param: 'type',
    docUrl: 'https://stripe.com/docs/error-codes/resource-missing',
    message: 'You cannot create Identity VerificationSessions until you activate…',
  });
});

Deno.test('a plain Error still yields a usable line, never an empty object', () => {
  // The bare catch this replaces produced nothing at all; a non-Stripe throw (a TypeError in
  // our own code) must not regress to that.
  const facts = describeStripeError(new Error('stripe down'));
  assertEquals(facts.message, 'stripe down');
  assertEquals(facts.statusCode, null);
  assertEquals(facts.rawType, null);
});

Deno.test('a thrown non-Error is still described', () => {
  assertEquals(describeStripeError('kaboom').message, 'kaboom');
  assertEquals(describeStripeError(null).message, 'null');
  assertEquals(describeStripeError(undefined).message, 'undefined');
});

Deno.test('empty strings are normalised to null rather than reported as present', () => {
  const facts = describeStripeError(stripeError({ code: '', requestId: '' }));
  assertEquals(facts.code, null);
  assertEquals(facts.requestId, null);
});

Deno.test('no field is invented from a non-string', () => {
  const facts = describeStripeError(stripeError({ code: 42, statusCode: 'nope' }));
  assertEquals(facts.code, null);
  assertEquals(facts.statusCode, null);
});

Deno.test('4xx is a configuration failure — retrying it is a lie', () => {
  for (const statusCode of [400, 401, 403, 404]) {
    assertEquals(
      stripeFailureClass(describeStripeError(stripeError({ statusCode }))),
      'configuration',
    );
  }
});

Deno.test('429, 5xx and never-reached-Stripe are transient', () => {
  for (const statusCode of [429, 500, 502, 503]) {
    assertEquals(stripeFailureClass(describeStripeError(stripeError({ statusCode }))), 'transient');
  }
  // a connection error carries no status: the request never reached Stripe
  assertEquals(stripeFailureClass(describeStripeError(new Error('socket hang up'))), 'transient');
});

Deno.test('logStripeFailure writes one line naming the reason and returns the facts', () => {
  // Acceptance criterion of #416: a failing call leaves a log line naming the Stripe reason.
  const lines: Array<[string, StripeErrorFacts]> = [];
  const facts = logStripeFailure('identity.verificationSessions.create', stripeError(), (op, f) =>
    lines.push([op, f]),
  );
  assertEquals(lines.length, 1);
  assertEquals(lines[0][0], 'identity.verificationSessions.create');
  assertEquals(lines[0][1].rawType, 'invalid_request_error');
  assertEquals(lines[0][1].code, 'resource_missing');
  assertEquals(lines[0][1].requestId, 'req_123');
  assertEquals(facts, lines[0][1]);
});

Deno.test('the facts carry no secret — only fields Stripe itself returned', () => {
  // Security: code must never log keys. Nothing in this module reads the env, so the only way
  // a key could appear is if Stripe echoed one; it redacts its own. Pin the key set so a later
  // field addition is a deliberate review decision.
  assertEquals(Object.keys(describeStripeError(stripeError())).sort(), [
    'code',
    'docUrl',
    'message',
    'param',
    'rawType',
    'requestId',
    'statusCode',
    'type',
  ]);
});
