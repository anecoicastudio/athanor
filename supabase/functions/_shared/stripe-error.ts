// Every Stripe call in this codebase used to sit inside a bare `catch {}` (#416): an inactive
// product, a key without the right permission, an API-version mismatch and a rate limit all
// collapsed into one 500 with one string, and the Stripe error reached no log at all. That
// silence is what made #416 cost a device session to notice. This module is the un-swallow.
//
// Deliberately imports NOTHING from ./stripe.ts. Until #541 that module constructed the client
// at import time and would have demanded STRIPE_SECRET_KEY in the env of every test that
// imports a logic module; it is lazy now, so what keeps the boundary is direction — an error
// reader must not depend on the client whose failures it reports.
// Stripe errors are read structurally instead, which also means a thrown non-Stripe error
// (a TypeError in our own code) still produces a usable line rather than `{}`.

/** The operator-readable fields of a Stripe failure. Never carries the API key. */
export type StripeErrorFacts = {
  /** stripe-node's constructor name, e.g. 'StripeInvalidRequestError' */
  type: string | null;
  /** the API-level type, e.g. 'invalid_request_error' */
  rawType: string | null;
  /** the API-level code, e.g. 'resource_missing' */
  code: string | null;
  statusCode: number | null;
  /** Stripe's request id — the one thing Stripe support can act on */
  requestId: string | null;
  param: string | null;
  docUrl: string | null;
  message: string;
};

const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/**
 * Extracts what an operator needs from a thrown Stripe error, structurally — a StripeError
 * carries `type` (class name), `rawType` (API type), `code`, `statusCode`, `requestId`, `param`
 * and `doc_url`. Anything unrecognised still yields a `message`, so the log line is never empty.
 *
 * Stripe redacts the key in its own `authentication_error` message; nothing here reads the env,
 * so no secret can enter these facts (security: code must never log keys).
 */
export function describeStripeError(e: unknown): StripeErrorFacts {
  const raw = (e ?? {}) as Record<string, unknown>;
  return {
    type: str(raw.type),
    rawType: str(raw.rawType),
    code: str(raw.code),
    statusCode: num(raw.statusCode),
    requestId: str(raw.requestId),
    param: str(raw.param),
    docUrl: str(raw.doc_url),
    message: str(raw.message) ?? (typeof e === 'string' ? e : String(e)),
  };
}

/**
 * Two classes, because they are the two a member can act on differently:
 *
 * - `configuration` — the operator must do something (activate the product, fix the key,
 *   align the API version). Retrying is useless and telling someone to "try again" is a lie.
 * - `transient` — Stripe's side or the network. Retrying is exactly right.
 *
 * Discriminated on HTTP status rather than on stripe-node's class names: the status is stable
 * across SDK majors, and an absent status means the request never reached Stripe at all.
 *
 * PRECONDITION: only sound where the request params carry no caller-supplied values. A 4xx on
 * static, server-built params can only be our configuration; a 4xx on a user-influenced amount
 * or id could be the caller's doing and must not be reported as an outage.
 */
export type StripeFailureClass = 'configuration' | 'transient';

export function stripeFailureClass(facts: StripeErrorFacts): StripeFailureClass {
  const status = facts.statusCode;
  if (status === null) return 'transient'; // connection/timeout — never reached Stripe
  if (status === 429) return 'transient'; // rate limit — backing off is the correct response
  if (status >= 400 && status < 500) return 'configuration';
  return 'transient'; // 5xx — Stripe's own
}

/** Where a failure line goes. Injectable so a test can assert the line exists and read it. */
export type StripeFailureSink = (operation: string, facts: StripeErrorFacts) => void;

/** console.error reaches the Supabase function logs, which is the only place an operator looks. */
export const consoleSink: StripeFailureSink = (operation, facts) => {
  console.error(`[stripe] ${operation} failed`, JSON.stringify(facts));
};

/**
 * Bind, describe, log, and hand the facts back so a caller can classify without describing twice.
 * Call this from every `catch` around a Stripe call — the response stays generic, the reason
 * lands in the logs.
 */
export function logStripeFailure(
  operation: string,
  e: unknown,
  sink: StripeFailureSink = consoleSink,
): StripeErrorFacts {
  const facts = describeStripeError(e);
  sink(operation, facts);
  return facts;
}
