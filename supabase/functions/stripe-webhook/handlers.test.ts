// deno test supabase/functions/stripe-webhook/ — runs in CI (edge job) and locally.
// Characterization tests for the webhook money paths: per-event handlers, routing,
// and the 3-layer idempotency pipeline. All I/O goes through the injected fake db
// (repo convention: DI over mocks) + real signQrToken with a fixed test secret.
import { assert, assertEquals, assertRejects } from 'jsr:@std/assert@1';
// stripe pinned to major 22: deno.lock is gitignored, so CI resolves fresh on every
// run — an unpinned specifier would typecheck against latest and redden on SDK majors.
import type Stripe from 'npm:stripe@22';
import { makeFakeDb, type FakeDb } from '../_shared/fake-db.ts';
import { signQrToken } from '../_shared/qr.ts';
import {
  type Db,
  type WebhookCtx,
  handleContribution,
  handleContributionRefunded,
  handleIdentityFailed,
  handleIdentityVerified,
  handleInvoiceFailed,
  handleSubscription,
  handleTicketPaid,
  handleWebhook,
  mapSubStatus,
  processEvent,
} from './handlers.ts';

const SECRET = 'test-qr-secret';
const asDb = (f: FakeDb) => f as unknown as Db;

const ticketSession = (over: Record<string, unknown> = {}) =>
  ({
    id: 'cs_1',
    created: 1751000000,
    currency: 'eur',
    payment_intent: 'pi_1',
    metadata: { kind: 'ticket', event_id: 'evt-row-1', profile_id: 'prof-1' },
    ...over,
  }) as unknown as Stripe.Checkout.Session;

const contributionSession = (over: Record<string, unknown> = {}) =>
  ({
    id: 'cs_c1',
    created: 1751000000,
    currency: 'EUR',
    amount_total: 2500,
    payment_intent: 'pi_c1',
    metadata: { kind: 'contribution', edition_id: 'ed-1', profile_id: 'prof-1' },
    ...over,
  }) as unknown as Stripe.Checkout.Session;

const subscription = (over: Record<string, unknown> = {}) =>
  ({
    id: 'sub_1',
    status: 'active',
    customer: 'cus_1',
    metadata: { profile_id: 'prof-1' },
    items: {
      data: [{ price: { recurring: { interval: 'month' } }, current_period_end: 1760000000 }],
    },
    ...over,
  }) as unknown as Stripe.Subscription;

const stripeEvent = (type: string, object: unknown, id = 'evt_1') =>
  ({ id, type, data: { object } }) as unknown as Stripe.Event;

// ── mapSubStatus (pure) ──────────────────────────────────────────────────────

Deno.test('mapSubStatus maps every Stripe status to the membership enum', () => {
  assertEquals(mapSubStatus('active'), 'active');
  assertEquals(mapSubStatus('trialing'), 'active');
  assertEquals(mapSubStatus('past_due'), 'past_due');
  assertEquals(mapSubStatus('incomplete'), 'incomplete');
  assertEquals(mapSubStatus('canceled'), 'canceled');
  assertEquals(mapSubStatus('unpaid'), 'canceled');
  assertEquals(mapSubStatus('incomplete_expired'), 'canceled');
  assertEquals(mapSubStatus('paused'), 'canceled');
});

// ── W1 handleTicketPaid ──────────────────────────────────────────────────────

Deno.test('handleTicketPaid throws on missing metadata (Stripe must retry)', async () => {
  const db = makeFakeDb();
  await assertRejects(
    () => handleTicketPaid(asDb(db), SECRET, ticketSession({ metadata: { kind: 'ticket' } })),
    Error,
    'missing metadata',
  );
  assertEquals(db.calls.length, 0);
});

Deno.test('handleTicketPaid upserts paid ticket idempotently with deterministic QR', async () => {
  const db1 = makeFakeDb();
  const db2 = makeFakeDb();
  await handleTicketPaid(asDb(db1), SECRET, ticketSession());
  await handleTicketPaid(asDb(db2), SECRET, ticketSession()); // simulated redelivery

  const [call] = db1.calls;
  assertEquals(call.table, 'event_tickets');
  assertEquals(call.op, 'upsert');
  assertEquals(call.options, { onConflict: 'user_id,event_id', ignoreDuplicates: true });
  const values = call.values as Record<string, unknown>;
  assertEquals(values.status, 'paid');
  assertEquals(values.stripe_payment_id, 'pi_1');
  // iat = session.created → a retry issues the IDENTICAL token (no unique churn).
  const retryValues = db2.calls[0].values as Record<string, unknown>;
  assertEquals(values.qr_token, retryValues.qr_token);
  assertEquals(
    values.qr_token,
    await signQrToken({ eid: 'evt-row-1', uid: 'prof-1', iat: 1751000000 }, SECRET),
  );
});

// ── W3 handleContribution ────────────────────────────────────────────────────

Deno.test('handleContribution throws on missing edition_id / amount_total', async () => {
  await assertRejects(
    () => handleContribution(asDb(makeFakeDb()), contributionSession({ metadata: {} })),
    Error,
    'edition_id',
  );
  await assertRejects(
    () => handleContribution(asDb(makeFakeDb()), contributionSession({ amount_total: null })),
    Error,
    'amount_total',
  );
});

Deno.test('handleContribution writes row then recomputes the aggregate', async () => {
  const db = makeFakeDb({ 'fund_contributions.upsert': [{ count: 1 }] });
  await handleContribution(asDb(db), contributionSession());

  const [upsert, rpc] = db.calls;
  assertEquals(upsert.table, 'fund_contributions');
  assertEquals(upsert.options, {
    onConflict: 'stripe_checkout_session_id',
    ignoreDuplicates: true,
    count: 'exact',
  });
  const values = upsert.values as Record<string, unknown>;
  assertEquals(values.amount_cents, 2500);
  assertEquals(values.currency, 'eur'); // lowercased
  assertEquals(values.status, 'succeeded');
  assertEquals(rpc.columns, 'recompute_fund_aggregate');
  assertEquals(rpc.values, { p_edition_id: 'ed-1' });
});

Deno.test(
  'handleContribution duplicate delivery (count 0) skips the aggregate recompute',
  async () => {
    const db = makeFakeDb({ 'fund_contributions.upsert': [{ count: 0 }] });
    await handleContribution(asDb(db), contributionSession());
    assertEquals(db.calls.length, 1); // upsert only — no rpc
  },
);

// ── W4 handleContributionRefunded ────────────────────────────────────────────

Deno.test(
  'handleContributionRefunded acks charges without payment_intent or matching row',
  async () => {
    const db1 = makeFakeDb();
    await handleContributionRefunded(asDb(db1), {
      payment_intent: null,
    } as unknown as Stripe.Charge);
    assertEquals(db1.calls.length, 0);

    const db2 = makeFakeDb({ 'fund_contributions.select': [{ data: [] }] });
    await handleContributionRefunded(asDb(db2), {
      payment_intent: 'pi_x',
    } as unknown as Stripe.Charge);
    assertEquals(db2.calls.length, 1); // select only — a ticket refund never touches fund rows
  },
);

Deno.test(
  'handleContributionRefunded flips succeeded→refunded with guard and recomputes',
  async () => {
    const db = makeFakeDb({
      'fund_contributions.select': [{ data: [{ id: 'c1', edition_id: 'ed-9' }] }],
    });
    await handleContributionRefunded(asDb(db), {
      payment_intent: { id: 'pi_c1' },
    } as unknown as Stripe.Charge);
    const [sel, upd, rpc] = db.calls;
    assertEquals(sel.filters, [
      ['eq', 'stripe_payment_intent_id', 'pi_c1'],
      ['eq', 'status', 'succeeded'],
    ]);
    assertEquals(upd.op, 'update');
    assertEquals(upd.values, { status: 'refunded' });
    // idempotency guard: re-delivered refund can't re-flip
    assert(upd.filters.some(([f, c, v]) => f === 'eq' && c === 'status' && v === 'succeeded'));
    assertEquals(rpc.values, { p_edition_id: 'ed-9' });
  },
);

// ── W5/W6/W7/W11 handleSubscription ──────────────────────────────────────────

Deno.test('handleSubscription throws without profile_id metadata', async () => {
  await assertRejects(
    () => handleSubscription(asDb(makeFakeDb()), subscription({ metadata: {} })),
    Error,
    'profile_id',
  );
});

Deno.test('handleSubscription upserts one membership per profile with derived fields', async () => {
  const db = makeFakeDb();
  await handleSubscription(asDb(db), subscription());
  const [call] = db.calls;
  assertEquals(call.table, 'circle_memberships');
  assertEquals(call.options, { onConflict: 'profile_id' });
  const values = call.values as Record<string, unknown>;
  assertEquals(values.plan, 'monthly');
  assertEquals(values.status, 'active');
  assertEquals(values.stripe_customer_id, 'cus_1');
  assertEquals(values.current_period_end, new Date(1760000000 * 1000).toISOString());
});

Deno.test(
  'handleSubscription derives annual plan and falls back to sub-level period end',
  async () => {
    const db = makeFakeDb();
    await handleSubscription(
      asDb(db),
      subscription({
        status: 'unpaid',
        customer: { id: 'cus_2' },
        items: { data: [{ price: { recurring: { interval: 'year' } } }] }, // no item period end
        current_period_end: 1770000000,
      }),
    );
    const values = db.calls[0].values as Record<string, unknown>;
    assertEquals(values.plan, 'annual');
    assertEquals(values.status, 'canceled'); // unpaid → canceled via mapSubStatus
    assertEquals(values.stripe_customer_id, 'cus_2');
    assertEquals(values.current_period_end, new Date(1770000000 * 1000).toISOString());
  },
);

// ── W8 handleInvoiceFailed ───────────────────────────────────────────────────

Deno.test(
  'handleInvoiceFailed acks non-subscription invoices, flags past_due otherwise',
  async () => {
    const db1 = makeFakeDb();
    await handleInvoiceFailed(asDb(db1), { subscription: null } as unknown as Stripe.Invoice);
    assertEquals(db1.calls.length, 0);

    const db2 = makeFakeDb();
    await handleInvoiceFailed(asDb(db2), { subscription: 'sub_1' } as unknown as Stripe.Invoice);
    const [call] = db2.calls;
    assertEquals(call.table, 'circle_memberships');
    assertEquals(call.values, { status: 'past_due' });
    assertEquals(call.filters, [['eq', 'stripe_subscription_id', 'sub_1']]);
  },
);

// ── W9/W10 identity handlers ─────────────────────────────────────────────────

Deno.test('handleIdentityVerified caches the row and flips the profile flag', async () => {
  const db = makeFakeDb();
  await handleIdentityVerified(asDb(db), {
    id: 'vs_1',
    metadata: { profile_id: 'prof-1' },
  } as unknown as Stripe.Identity.VerificationSession);
  const [ver, prof] = db.calls;
  assertEquals(ver.table, 'verifications');
  assertEquals(ver.options, { onConflict: 'stripe_session_id' });
  assertEquals((ver.values as Record<string, unknown>).status, 'verified');
  assertEquals(prof.table, 'profiles');
  assertEquals(prof.values, { identity_verified: true });
  assertEquals(prof.filters, [['eq', 'id', 'prof-1']]);
});

Deno.test('handleIdentityFailed caches failed and never touches profiles', async () => {
  const db = makeFakeDb();
  await handleIdentityFailed(asDb(db), {
    id: 'vs_1',
    metadata: { profile_id: 'prof-1' },
  } as unknown as Stripe.Identity.VerificationSession);
  assertEquals(db.calls.length, 1);
  assertEquals(db.calls[0].table, 'verifications');
  assertEquals((db.calls[0].values as Record<string, unknown>).status, 'failed');
});

// ── processEvent routing ─────────────────────────────────────────────────────

const routingCtx = (db: FakeDb, retrieved?: Stripe.Subscription) => {
  const retrieveCalls: string[] = [];
  return {
    db: asDb(db),
    qrSecret: SECRET,
    retrieveCalls,
    retrieveSubscription: (id: string) => {
      retrieveCalls.push(id);
      return Promise.resolve(retrieved ?? subscription());
    },
  };
};

Deno.test('processEvent routes each event type to the right table', async () => {
  const cases: [string, unknown, string][] = [
    ['checkout.session.completed', ticketSession(), 'event_tickets'],
    ['checkout.session.completed', contributionSession(), 'fund_contributions'],
    ['customer.subscription.updated', subscription(), 'circle_memberships'],
    ['customer.subscription.deleted', subscription({ status: 'canceled' }), 'circle_memberships'],
    ['invoice.payment_failed', { subscription: 'sub_1' }, 'circle_memberships'],
    [
      'identity.verification_session.verified',
      { id: 'vs_1', metadata: { profile_id: 'p' } },
      'verifications',
    ],
    [
      'identity.verification_session.requires_input',
      { id: 'vs_1', metadata: { profile_id: 'p' } },
      'verifications',
    ],
  ];
  for (const [type, object, table] of cases) {
    const db = makeFakeDb({ 'fund_contributions.upsert': [{ count: 1 }] });
    await processEvent(routingCtx(db), stripeEvent(type, object));
    assertEquals(db.calls[0]?.table, table, `${type} should write ${table}`);
  }
});

Deno.test('processEvent W11 reconcile retrieves the subscription from checkout', async () => {
  const db = makeFakeDb();
  const ctx = routingCtx(db);
  await processEvent(
    ctx,
    stripeEvent('checkout.session.completed', {
      id: 'cs_s1',
      metadata: { kind: 'subscription' },
      subscription: 'sub_99',
    }),
  );
  assertEquals(ctx.retrieveCalls, ['sub_99']);
  assertEquals(db.calls[0].table, 'circle_memberships');
});

Deno.test('processEvent acknowledges unknown event types without any write', async () => {
  const db = makeFakeDb();
  await processEvent(routingCtx(db), stripeEvent('payment_intent.created', {}));
  assertEquals(db.calls.length, 0);
});

// ── handleWebhook — signature + 3-layer idempotency pipeline ─────────────────

const webhookReq = (body = '{}', sig: string | null = 'sig_ok') => {
  const headers = new Headers();
  if (sig) headers.set('stripe-signature', sig);
  return new Request('http://localhost/stripe-webhook', { method: 'POST', headers, body });
};

const webhookCtx = (db: FakeDb, event?: Stripe.Event): WebhookCtx => ({
  db: asDb(db),
  qrSecret: SECRET,
  verifyEvent: () => (event ? Promise.resolve(event) : Promise.reject(new Error('bad signature'))),
  retrieveSubscription: () => Promise.resolve(subscription()),
});

Deno.test('handleWebhook 400s on missing or invalid signature, before any db touch', async () => {
  const db = makeFakeDb();
  const missing = await handleWebhook(webhookCtx(db, stripeEvent('x', {})), webhookReq('{}', null));
  assertEquals(missing.status, 400);
  const bad = await handleWebhook(webhookCtx(db /* verifyEvent rejects */), webhookReq());
  assertEquals(bad.status, 400);
  assertEquals(db.calls.length, 0);
});

Deno.test('handleWebhook 500s when the idempotency ledger cannot be written', async () => {
  const db = makeFakeDb({ 'stripe_webhook_events.upsert': [{ error: { message: 'boom' } }] });
  const res = await handleWebhook(
    webhookCtx(db, stripeEvent('payment_intent.created', {})),
    webhookReq(),
  );
  assertEquals(res.status, 500);
  assertEquals(db.calls.length, 1); // never proceeded past the ledger
});

Deno.test(
  'handleWebhook true replays (processed_at set) ack 200 without reprocessing',
  async () => {
    // Claim returns zero rows AND the disambiguating read shows the event is done.
    const db = makeFakeDb({
      'stripe_webhook_events.update': [{ data: [] }],
      'stripe_webhook_events.select': [{ data: { processed_at: '2026-08-01T00:00:00Z' } }],
    });
    const res = await handleWebhook(
      webhookCtx(db, stripeEvent('checkout.session.completed', ticketSession())),
      webhookReq(),
    );
    assertEquals(res.status, 200);
    assertEquals(await res.text(), 'already processed');
    // upsert + claim + disambiguating read only — no ticket write
    assertEquals(db.calls.length, 3);
    assert(db.calls.every((c) => c.table === 'stripe_webhook_events'));
    // guarded lease claim: eq(event_id) AND is(processed_at, null) AND (claimed_at null | stale)
    const claim = db.calls[1];
    assertEquals(claim.filters.slice(0, 2), [
      ['eq', 'event_id', 'evt_1'],
      ['is', 'processed_at', null],
    ]);
    const orFilter = claim.filters[2];
    assertEquals(orFilter[0], 'or');
    assert(String(orFilter[1]).startsWith('claimed_at.is.null,claimed_at.lt.'));
    // the claim writes the lease, not the completion marker
    assert((claim.values as Record<string, unknown>).claimed_at);
    assertEquals((claim.values as Record<string, unknown>).processed_at, undefined);
  },
);

Deno.test('handleWebhook 409s when a live lease holds the event (Stripe must retry)', async () => {
  // The crash-recovery case: claim lost, processed_at still NULL. Acking here would
  // consume Stripe's retry budget and drop the event permanently.
  const db = makeFakeDb({
    'stripe_webhook_events.update': [{ data: [] }],
    'stripe_webhook_events.select': [{ data: { processed_at: null } }],
  });
  const res = await handleWebhook(
    webhookCtx(db, stripeEvent('checkout.session.completed', ticketSession())),
    webhookReq(),
  );
  assertEquals(res.status, 409);
  assert(!db.calls.some((c) => c.table === 'event_tickets'));
});

Deno.test('handleWebhook 500s when the disambiguating ledger read fails', async () => {
  const db = makeFakeDb({
    'stripe_webhook_events.update': [{ data: [] }],
    'stripe_webhook_events.select': [{ error: { message: 'boom' } }],
  });
  const res = await handleWebhook(
    webhookCtx(db, stripeEvent('checkout.session.completed', ticketSession())),
    webhookReq(),
  );
  assertEquals(res.status, 500);
});

Deno.test('handleWebhook happy path: lease claim → process → stamp processed_at', async () => {
  const db = makeFakeDb({
    'stripe_webhook_events.update': [
      { data: [{ event_id: 'evt_1' }] }, // lease claim won
      { data: [{ event_id: 'evt_1' }] }, // processed_at stamp
    ],
  });
  const res = await handleWebhook(
    webhookCtx(db, stripeEvent('checkout.session.completed', ticketSession())),
    webhookReq(),
  );
  assertEquals(res.status, 200);
  const tables = db.calls.map((c) => `${c.table}.${c.op}`);
  assertEquals(tables, [
    'stripe_webhook_events.upsert',
    'stripe_webhook_events.update', // lease claim (claimed_at)
    'event_tickets.upsert',
    'stripe_webhook_events.update', // completion stamp AFTER successful processing
  ]);
  const ourClaim = (db.calls[1].values as Record<string, unknown>).claimed_at;
  assert(ourClaim);
  assert((db.calls[3].values as Record<string, unknown>).processed_at);
  // the completion stamp is guarded on OUR lease — never stamps over a re-claim
  assertEquals(db.calls[3].filters, [
    ['eq', 'event_id', 'evt_1'],
    ['eq', 'claimed_at', ourClaim],
  ]);
});

Deno.test(
  'handleWebhook processing failure releases the lease and 500s (Stripe retries)',
  async () => {
    const db = makeFakeDb({
      'stripe_webhook_events.update': [
        { data: [{ event_id: 'evt_1' }] }, // claim won
        { data: [{ event_id: 'evt_1' }] }, // release succeeds
      ],
      'event_tickets.upsert': [{ error: { message: 'db down' } }],
    });
    const res = await handleWebhook(
      webhookCtx(db, stripeEvent('checkout.session.completed', ticketSession())),
      webhookReq(),
    );
    assertEquals(res.status, 500);
    // release sets claimed_at back to NULL so the retry can re-claim immediately;
    // processed_at is never stamped on the failure path
    const updates = db.calls.filter(
      (c) => c.table === 'stripe_webhook_events' && c.op === 'update',
    );
    assertEquals(updates.length, 2);
    assertEquals((updates[1].values as Record<string, unknown>).claimed_at, null);
    assert(!updates.some((u) => (u.values as Record<string, unknown>).processed_at));
    // release is guarded on OUR lease — a timed-out isolate can't clear a newer claim
    assertEquals(updates[1].filters, [
      ['eq', 'event_id', 'evt_1'],
      ['eq', 'claimed_at', (updates[0].values as Record<string, unknown>).claimed_at],
    ]);
  },
);

Deno.test('handleWebhook 500s when the claim update itself errors', async () => {
  const db = makeFakeDb({
    'stripe_webhook_events.update': [{ error: { message: 'boom' } }],
  });
  const res = await handleWebhook(
    webhookCtx(db, stripeEvent('checkout.session.completed', ticketSession())),
    webhookReq(),
  );
  assertEquals(res.status, 500);
  assert(!db.calls.some((c) => c.table === 'event_tickets'));
});
