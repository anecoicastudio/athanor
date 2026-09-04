// deno test supabase/functions/stripe-webhook/ — runs in CI (edge job) and locally.
// Characterization tests for the webhook money paths: per-event handlers, routing,
// and the 3-layer idempotency pipeline. All I/O goes through the injected fake db
// (repo convention: DI over mocks) + real signQrToken with a fixed test secret.
import { assert, assertEquals, assertRejects, assertThrows } from 'jsr:@std/assert@1';
// stripe pinned to major 22: deno.lock is gitignored, so CI resolves fresh on every
// run — an unpinned specifier would typecheck against latest and redden on SDK majors.
import type Stripe from 'npm:stripe@22';
import { makeFakeDb, type FakeCall, type FakeDb } from '../_shared/fake-db.ts';
import { signQrToken } from '../_shared/qr.ts';
import {
  type Db,
  type WebhookCtx,
  assertSettled,
  handleAccountUpdated,
  handleChargeRefunded,
  handleContribution,
  handleDisputeCreated,
  handleIdentityFailed,
  handleIdentityVerified,
  handleInvoiceFailed,
  handleSubscription,
  handleTicketPaid,
  handleTransferCreated,
  handleTransferReversed,
  handleWebhook,
  mapSubStatus,
  processEvent,
} from './handlers.ts';

const SECRET = 'test-qr-secret';
const asDb = (f: FakeDb) => f as unknown as Db;

// payment_status: 'paid' is what every payment method enabled on the account reports on
// checkout.session.completed — card, Bancontact, EPS, Link, wallets, and PayPal (Stripe
// permits only synchronous funding sources on PayPal unless you ask Support to enable
// asynchronous ones). Delayed-notification methods report 'unpaid' here; none are enabled,
// and assertSettled throws rather than trusting that to stay true.
const ticketSession = (over: Record<string, unknown> = {}) =>
  ({
    id: 'cs_1',
    created: 1751000000,
    currency: 'eur',
    payment_status: 'paid',
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
    payment_status: 'paid',
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
    cancel_at_period_end: false,
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
  assertEquals(call.options, {
    onConflict: 'user_id,event_id',
    ignoreDuplicates: true,
    count: 'exact',
  });
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

Deno.test(
  'handleTicketPaid leaves an existing live ticket alone on a swallowed upsert',
  async () => {
    // count 0 = the row already existed. Almost always a redelivery (possibly under a NEW Stripe
    // event id, which the processed_at gate can't catch) — a paid or checked_in row must never
    // be touched: no status reset, no QR churn.
    for (const status of ['paid', 'checked_in']) {
      const db = makeFakeDb({
        'event_tickets.upsert': [{ count: 0 }],
        'event_tickets.select': [{ data: { status, stripe_payment_id: 'pi_1' } }],
      });
      await handleTicketPaid(asDb(db), SECRET, ticketSession());
      // The trailing upsert is the #522 RSVP mirror, restated on every redelivery of a live
      // ticket — idempotent, and the only path that heals a ticket sold before the mirror
      // existed. It is an rsvps write, so it touches nothing this test is guarding.
      assertEquals(
        db.calls.map((c) => `${c.table}.${c.op}`),
        ['event_tickets.upsert', 'event_tickets.select', 'rsvps.upsert'],
        `status ${status}: no repair update expected`,
      );
    }
  },
);

Deno.test('handleTicketPaid re-issues a refunded ticket on a genuine re-purchase', async () => {
  // After a refund the TicketBar re-offers purchase; the new Checkout session carries a NEW
  // payment intent. The unique(user_id,event_id) row exists, so the upsert is swallowed —
  // the repair path must flip it back to paid with the new PI and a fresh QR.
  const db = makeFakeDb({
    'event_tickets.upsert': [{ count: 0 }],
    'event_tickets.select': [{ data: { status: 'refunded', stripe_payment_id: 'pi_old' } }],
  });
  await handleTicketPaid(asDb(db), SECRET, ticketSession({ payment_intent: 'pi_2' }));
  const upd = db.calls.find((c) => c.op === 'update');
  assert(upd, 'expected a repair update');
  const values = upd.values as Record<string, unknown>;
  assertEquals(values.status, 'paid');
  assertEquals(values.stripe_payment_id, 'pi_2');
  assertEquals(
    values.qr_token,
    await signQrToken({ eid: 'evt-row-1', uid: 'prof-1', iat: 1751000000 }, SECRET),
  );
  // guard: only a pending claim or a refunded row is payable — a concurrent check-in
  // can't be overwritten
  assert(
    upd.filters.some(
      ([f, c, v]) => f === 'in' && c === 'status' && JSON.stringify(v) === '["pending","refunded"]',
    ),
  );
});

Deno.test('handleTicketPaid pays the pending seat claim (#105 — the common path)', async () => {
  // claim_event_seat wrote the pending row BEFORE the Session was minted, so the upsert is
  // always swallowed (count 0) and the flip below is what actually issues the ticket. It
  // must land even for a claim whose TTL lapsed — the money moved.
  const db = makeFakeDb({
    'event_tickets.upsert': [{ count: 0 }],
    'event_tickets.select': [{ data: { status: 'pending', stripe_payment_id: null } }],
  });
  await handleTicketPaid(asDb(db), SECRET, ticketSession());
  const upd = db.calls.find((c) => c.op === 'update');
  assert(upd, 'expected the pending claim to be paid');
  const values = upd.values as Record<string, unknown>;
  assertEquals(values.status, 'paid');
  assertEquals(values.stripe_payment_id, 'pi_1');
  assertEquals(values.expires_at, null); // the seat-hold TTL is over — the seat is owned now
  assertEquals(
    values.qr_token,
    await signQrToken({ eid: 'evt-row-1', uid: 'prof-1', iat: 1751000000 }, SECRET),
  );
});

Deno.test('handleTicketPaid never resurrects a refunded ticket from a stale replay', async () => {
  // A duplicate delivery of the ORIGINAL purchase session (new event id, same payment intent)
  // arriving after the refund must not undo the revocation: same PI as the refunded row → ack.
  const db = makeFakeDb({
    'event_tickets.upsert': [{ count: 0 }],
    'event_tickets.select': [{ data: { status: 'refunded', stripe_payment_id: 'pi_1' } }],
  });
  await handleTicketPaid(asDb(db), SECRET, ticketSession()); // session PI is pi_1
  assertEquals(
    db.calls.map((c) => c.op),
    ['upsert', 'select'], // no update — the refund stands
  );
});

Deno.test('handleTicketPaid refuses an unsettled session and writes nothing', async () => {
  // Delayed settlement is unsupported by design. If a delayed rail is ever enabled in the
  // Stripe Dashboard the session completes while the debit is still processing — issuing a QR
  // there would let someone through the door on money that may never arrive. Throwing 500s the
  // webhook, so Stripe retries and the ledger row stays at processed_at NULL.
  const db = makeFakeDb();
  await assertRejects(
    () => handleTicketPaid(asDb(db), SECRET, ticketSession({ payment_status: 'unpaid' })),
    Error,
    'unsettled',
  );
  assertEquals(db.calls.length, 0);
});

// ── W3 handleContribution ────────────────────────────────────────────────────

Deno.test(
  'handleContribution throws on missing edition_id / amount_total / profile_id',
  async () => {
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
    // #239: profile_id is NOT NULL — a null insert would 500 → redeliver forever, so the guard
    // throws before touching the db, exactly like the two above.
    await assertRejects(
      () =>
        handleContribution(
          asDb(makeFakeDb()),
          contributionSession({ metadata: { kind: 'contribution', edition_id: 'ed-1' } }),
        ),
      Error,
      'profile_id',
    );
  },
);

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
  assertEquals(values.profile_id, 'prof-1'); // never null — NOT NULL column (#239)
  assertEquals(values.amount_cents, 2500);
  // #236: this fixture carries no split metadata — the shape of a session minted before the
  // fee coverage shipped, and still in flight the day it deploys. The gift is the total.
  assertEquals(values.coverage_cents, 0);
  assertEquals(values.currency, 'eur'); // lowercased
  assertEquals(values.status, 'succeeded');
  assertEquals(rpc.columns, 'recompute_fund_aggregate');
  assertEquals(rpc.values, { p_edition_id: 'ed-1' });
});

// ── W3 × the optional fee coverage (#236 / FUND-51) ──────────────────────────

/** A contribution session with #236's split metadata, as create-contribution-session mints it. */
const coveredSession = (giftCents: number, coverageCents: number) =>
  contributionSession({
    amount_total: giftCents + coverageCents,
    metadata: {
      kind: 'contribution',
      edition_id: 'ed-1',
      profile_id: 'prof-1',
      gift_cents: String(giftCents),
      coverage_cents: String(coverageCents),
    },
  });

Deno.test('handleContribution stores the GIFT in amount_cents, coverage beside it', async () => {
  // €1,00 gift + €0,27 coverage = €1,27 charged. The pool must move by 100, never by 127:
  // recompute_fund_aggregate and every FUND-42 computation read amount_cents, and the 27
  // went to Stripe, not to the fund.
  const db = makeFakeDb({ 'fund_contributions.upsert': [{ count: 1 }] });
  await handleContribution(asDb(db), coveredSession(100, 27));

  const values = db.calls[0].values as Record<string, unknown>;
  assertEquals(values.amount_cents, 100);
  assertEquals(values.coverage_cents, 27);
  // charged_cents is generated in the DB — the webhook must not try to state it.
  assertEquals('charged_cents' in values, false);
});

Deno.test('handleContribution stores an uncovered contribution unchanged', async () => {
  const db = makeFakeDb({ 'fund_contributions.upsert': [{ count: 1 }] });
  await handleContribution(asDb(db), coveredSession(2500, 0));

  const values = db.calls[0].values as Record<string, unknown>;
  assertEquals(values.amount_cents, 2500);
  assertEquals(values.coverage_cents, 0);
});

Deno.test('handleContribution refuses a split that does not reconcile with Stripe', async () => {
  // Stripe is the source of truth and our two columns are its cache (rule #6). A split that
  // does not add up to amount_total means our figure and the charge disagree — and the one
  // the payer's card actually saw is Stripe's. Refuse rather than cache a fiction.
  const db = makeFakeDb({ 'fund_contributions.upsert': [{ count: 1 }] });
  await assertRejects(
    () =>
      handleContribution(
        asDb(db),
        contributionSession({
          amount_total: 127,
          metadata: {
            kind: 'contribution',
            edition_id: 'ed-1',
            profile_id: 'prof-1',
            gift_cents: '100',
            coverage_cents: '50', // 150 ≠ 127
          },
        }),
      ),
    Error,
    'does not reconcile',
  );
  assertEquals(db.calls.length, 0);
});

Deno.test('handleContribution refuses malformed split metadata', async () => {
  // ' ' and '' are the interesting ones: Number() maps both to 0, so a blank would have
  // become a silently valid zero coverage that reconciles against amount_total by accident.
  for (const coverage of ['abc', '-27', '2.5', ' ', '', '1e3', '0x1f', '99999999999999999999']) {
    const db = makeFakeDb({ 'fund_contributions.upsert': [{ count: 1 }] });
    await assertRejects(
      () =>
        handleContribution(
          asDb(db),
          contributionSession({
            metadata: {
              kind: 'contribution',
              edition_id: 'ed-1',
              profile_id: 'prof-1',
              coverage_cents: coverage,
            },
          }),
        ),
      Error,
      undefined,
      `coverage_cents ${JSON.stringify(coverage)} must be refused`,
    );
    assertEquals(db.calls.length, 0);
  }
});

Deno.test(
  'handleContribution duplicate delivery (count 0) skips the aggregate recompute',
  async () => {
    const db = makeFakeDb({ 'fund_contributions.upsert': [{ count: 0 }] });
    await handleContribution(asDb(db), contributionSession());
    assertEquals(db.calls.length, 1); // upsert only — no rpc
  },
);

Deno.test(
  'handleContribution refuses an unsettled session and never moves the ticker',
  async () => {
    // The Dream Fund ticker is public and realtime — showing money that has not arrived and
    // may never would be visible to everyone. Refuse the row outright rather than writing a
    // pending one the aggregate would later have to un-count.
    const db = makeFakeDb({ 'fund_contributions.upsert': [{ count: 1 }] });
    await assertRejects(
      () => handleContribution(asDb(db), contributionSession({ payment_status: 'unpaid' })),
      Error,
      'unsettled',
    );
    assertEquals(db.calls.length, 0);
  },
);

// ── assertSettled (the fail-closed gate itself) ──────────────────────────────

Deno.test('assertSettled passes final statuses and throws on everything else', () => {
  assertSettled(ticketSession()); // 'paid'
  assertSettled(ticketSession({ payment_status: 'no_payment_required' })); // 100% discount
  assertThrows(
    () => assertSettled(ticketSession({ payment_status: 'unpaid' })),
    Error,
    'unsettled',
  );
});

// ── #522 the RSVP mirror ─────────────────────────────────────────────────────
// `rsvps` was the free path's table alone, so the reminder sweep and «N partecipano» could not
// see anybody who paid. The mirror is what widens the audience without changing either read.

Deno.test('handleTicketPaid mirrors a settled ticket as a going RSVP', async () => {
  const db = makeFakeDb({ 'event_tickets.upsert': [{ count: 1 }] });
  await handleTicketPaid(asDb(db), SECRET, ticketSession());

  const mirror = db.calls.find((c) => c.table === 'rsvps');
  assert(mirror, 'expected an rsvps write');
  assertEquals(mirror.op, 'upsert');
  assertEquals(mirror.values, {
    user_id: 'prof-1',
    event_id: 'evt-row-1',
    status: 'going',
  });
  // do UPDATE, not ignoreDuplicates: a re-buy after a refund has to move 'cancelled' back.
  assertEquals(mirror.options, { onConflict: 'user_id,event_id' });
  // Order matters: the seat exists before the row that claims it does.
  assertEquals(
    db.calls.map((c) => `${c.table}.${c.op}`),
    ['event_tickets.upsert', 'rsvps.upsert'],
  );
});

Deno.test('the mirror rides assertSettled — unsettled money writes no RSVP', async () => {
  // The whole point of riding the existing gate rather than a narrower `=== 'paid'`: a 100%
  // coupon session reports 'no_payment_required' and IS a ticket, while a delayed-notification
  // method reports 'unpaid' and is not money yet. Neither may be special-cased here.
  const paid = makeFakeDb({ 'event_tickets.upsert': [{ count: 1 }] });
  await handleTicketPaid(
    asDb(paid),
    SECRET,
    ticketSession({ payment_status: 'no_payment_required' }),
  );
  assert(
    paid.calls.some((c) => c.table === 'rsvps'),
    'a free ticket still books a seat',
  );

  const unpaid = makeFakeDb();
  await assertRejects(
    () => handleTicketPaid(asDb(unpaid), SECRET, ticketSession({ payment_status: 'unpaid' })),
    Error,
    'unsettled',
  );
  assertEquals(unpaid.calls.length, 0, 'nothing at all is written before the money exists');
});

Deno.test('an indeterminate upsert count writes no RSVP', async () => {
  // The ticket half reads a null count as "inserted" (worst case: the old swallow). The mirror
  // cannot afford the same guess: on that branch a pre-existing `pending` row is possible, and
  // 20260831090931's exemption covers settled tickets only — so an RSVP written here would be a
  // capacity candidate and could raise P0001 INSIDE the webhook, which releases the lease and
  // 500s until Stripe disables the endpoint. A redelivery restates the mirror off the live-row
  // branch; one buyer's missed reminder is the cheaper side of that trade.
  const db = makeFakeDb(); // no script → count comes back null
  await handleTicketPaid(asDb(db), SECRET, ticketSession());
  assertEquals(
    db.calls.map((c) => `${c.table}.${c.op}`),
    ['event_tickets.upsert'],
  );
});

Deno.test(
  'the repair path mirrors, and a refunded replay does not resurrect the mirror',
  async () => {
    // A genuine re-purchase (NEW payment intent) flips the refunded ticket back to paid — and the
    // RSVP with it, or the buyer is silently missing from their own event again.
    const rebuy = makeFakeDb({
      'event_tickets.upsert': [{ count: 0 }],
      'event_tickets.select': [{ data: { status: 'refunded', stripe_payment_id: 'pi_old' } }],
    });
    await handleTicketPaid(asDb(rebuy), SECRET, ticketSession({ payment_intent: 'pi_2' }));
    const mirrored = rebuy.calls.find((c) => c.table === 'rsvps');
    assert(mirrored, 'a re-purchase re-books the seat');
    assertEquals((mirrored.values as Record<string, unknown>).status, 'going');

    // …but a redelivery of the ORIGINAL session after its refund carries the SAME payment intent.
    // Re-issuing there would undo the revocation, and re-mirroring would put a refunded ticket
    // holder back in «N partecipano».
    const replay = makeFakeDb({
      'event_tickets.upsert': [{ count: 0 }],
      'event_tickets.select': [{ data: { status: 'refunded', stripe_payment_id: 'pi_1' } }],
    });
    await handleTicketPaid(asDb(replay), SECRET, ticketSession());
    assertEquals(
      replay.calls.filter((c) => c.table === 'rsvps'),
      [],
      'a replay of the refunded session writes no RSVP',
    );
  },
);

// ── W4 handleChargeRefunded ──────────────────────────────────────────────────

Deno.test('handleChargeRefunded acks charges without payment_intent or matching row', async () => {
  const db1 = makeFakeDb();
  await handleChargeRefunded(asDb(db1), {
    payment_intent: null,
  } as unknown as Stripe.Charge);
  assertEquals(db1.calls.length, 0);

  const db2 = makeFakeDb({ 'fund_contributions.select': [{ data: [] }] });
  await handleChargeRefunded(asDb(db2), {
    payment_intent: 'pi_x',
  } as unknown as Stripe.Charge);
  // Fund rows are never updated on a miss — only the select ran, plus the guarded ticket
  // revocation (a no-op update when nothing matches). The ticket SELECT in front of it is the
  // #522 mirror lookup; it returns nothing here, so no rsvps write follows.
  assertEquals(
    db2.calls.map((c) => `${c.table}.${c.op}`),
    ['fund_contributions.select', 'event_tickets.select', 'event_tickets.update'],
  );
});

Deno.test('handleChargeRefunded flips succeeded→refunded with guard and recomputes', async () => {
  const db = makeFakeDb({
    'fund_contributions.select': [{ data: [{ id: 'c1', edition_id: 'ed-9' }] }],
  });
  await handleChargeRefunded(asDb(db), {
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
});

Deno.test('handleChargeRefunded revokes the matching ticket at the door', async () => {
  // The money left, so door access leaves with it: status → 'refunded' (check-in admits only
  // paid/checked_in) and the QR token is nulled so the viewer stops rendering a door pass.
  const db = makeFakeDb({ 'fund_contributions.select': [{ data: [] }] });
  await handleChargeRefunded(asDb(db), {
    payment_intent: { id: 'pi_1' },
  } as unknown as Stripe.Charge);
  const revoke = db.calls.find((c) => c.table === 'event_tickets' && c.op === 'update');
  assert(revoke, 'expected an event_tickets update');
  assertEquals(revoke.op, 'update');
  assertEquals(revoke.values, { status: 'refunded', qr_token: null });
  assertEquals(revoke.filters, [
    ['eq', 'stripe_payment_id', 'pi_1'],
    ['in', 'status', ['paid', 'checked_in']], // guard: a re-delivered reversal can't re-flip
  ]);
});

Deno.test('a reversal cancels the mirrored RSVP as well as the ticket', async () => {
  // The seat is gone, so the reminder and the head-count go with it. Both reversal paths share
  // revokeTicket, so both are asserted — a chargeback leaves exactly as little behind as a refund.
  for (const [label, run] of [
    [
      'refund',
      (db: FakeDb) =>
        handleChargeRefunded(asDb(db), { payment_intent: 'pi_1' } as unknown as Stripe.Charge),
    ],
    [
      'dispute',
      (db: FakeDb) =>
        handleDisputeCreated(asDb(db), { payment_intent: 'pi_1' } as unknown as Stripe.Dispute),
    ],
  ] as const) {
    const db = makeFakeDb({
      'fund_contributions.select': [{ data: [] }],
      'event_tickets.select': [{ data: [{ user_id: 'prof-1', event_id: 'evt-row-1' }] }],
    });
    await run(db);

    // The pair lookup runs BEFORE the guarded ticket flip: rsvps carries no payment column, and
    // reading after the flip would return nothing on a retry — stranding the mirror at 'going'
    // if a first delivery died between the two writes.
    assertEquals(
      db.calls.map((c) => `${c.table}.${c.op}`),
      ['fund_contributions.select', 'event_tickets.select', 'event_tickets.update', 'rsvps.update'],
      label,
    );
    const cancel = db.calls[3];
    assertEquals(cancel.values, { status: 'cancelled' }, label);
    assertEquals(
      cancel.filters,
      [
        ['eq', 'user_id', 'prof-1'],
        ['eq', 'event_id', 'evt-row-1'],
        ['eq', 'status', 'going'], // idempotency guard: a redelivered reversal can't re-flip
      ],
      label,
    );
  }
});

Deno.test('a reversal of a charge that bought no ticket leaves rsvps alone', async () => {
  // A fund contribution's refund reaches revokeTicket too. It must not touch the free path:
  // the match is the ticket row carrying this payment intent, and there is none.
  const db = makeFakeDb({
    'fund_contributions.select': [{ data: [{ id: 'c1', edition_id: 'ed-9' }] }],
    'event_tickets.select': [{ data: [] }],
  });
  await handleChargeRefunded(asDb(db), {
    payment_intent: 'pi_c1',
  } as unknown as Stripe.Charge);
  assertEquals(
    db.calls.filter((c) => c.table === 'rsvps'),
    [],
  );
});

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
  assertEquals(values.cancel_at_period_end, false);
});

// The renewal date is read from the subscription ITEM only. Stripe moved current_period_end
// there in 2025-03-31.basil and _shared/stripe.ts pins 2026-05-27.dahlia, so a payload
// carrying it at subscription level is not one this endpoint can receive — and if the pin ever
// moves back, this asserts we store null rather than silently reading a stale field.
Deno.test(
  'handleSubscription derives annual plan and ignores a subscription-level period end',
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
    assertEquals(values.current_period_end, null);
  },
);

// #511 — a member who cancelled stays `active` until the period ends, and Stripe marks that
// pending end ONLY with this flag. Without it cached, «renews on the 14th» and «ends on the
// 14th» are the same row and the app promises a charge that will never happen.
Deno.test(
  'handleSubscription caches a pending cancellation while the status is still active',
  async () => {
    const db = makeFakeDb();
    await handleSubscription(asDb(db), subscription({ cancel_at_period_end: true }));
    const values = db.calls[0].values as Record<string, unknown>;
    assertEquals(values.status, 'active'); // still a member for the period already paid for
    assertEquals(values.cancel_at_period_end, true);
  },
);

// Un-cancelling arrives on the same customer.subscription.updated with the flag back to false.
// Written through verbatim, so no branch is needed — this asserts the value is not sticky.
Deno.test('handleSubscription writes an un-cancel back through', async () => {
  const db = makeFakeDb();
  await handleSubscription(asDb(db), subscription({ cancel_at_period_end: false }));
  assertEquals((db.calls[0].values as Record<string, unknown>).cancel_at_period_end, false);
});

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

Deno.test('handleInvoiceFailed reads the post-Basil invoice.parent shape', async () => {
  // 2025-03-31.basil moved invoice.subscription → parent.subscription_details.subscription.
  // _shared/stripe.ts pins 2026-05-27.dahlia, so this IS the live payload shape; reading
  // only the legacy field meant no membership was ever marked past_due.
  const db = makeFakeDb();
  await handleInvoiceFailed(asDb(db), {
    parent: { type: 'subscription_details', subscription_details: { subscription: 'sub_b' } },
  } as unknown as Stripe.Invoice);
  assertEquals(db.calls[0].filters, [['eq', 'stripe_subscription_id', 'sub_b']]);

  // expanded object form
  const db2 = makeFakeDb();
  await handleInvoiceFailed(asDb(db2), {
    parent: { subscription_details: { subscription: { id: 'sub_c' } } },
  } as unknown as Stripe.Invoice);
  assertEquals(db2.calls[0].filters, [['eq', 'stripe_subscription_id', 'sub_c']]);
});

// ── W12 handleDisputeCreated ─────────────────────────────────────────────────

Deno.test('handleDisputeCreated acks disputes with no matching contribution', async () => {
  const db1 = makeFakeDb();
  await handleDisputeCreated(asDb(db1), { payment_intent: null } as unknown as Stripe.Dispute);
  assertEquals(db1.calls.length, 0);

  const db2 = makeFakeDb({ 'fund_contributions.select': [{ data: [] }] });
  await handleDisputeCreated(asDb(db2), { payment_intent: 'pi_x' } as unknown as Stripe.Dispute);
  // A disputed ticket never touches fund rows: no fund update, no aggregate recompute —
  // just the select miss, the #522 mirror lookup and the guarded ticket revocation.
  assertEquals(
    db2.calls.map((c) => `${c.table}.${c.op}`),
    ['fund_contributions.select', 'event_tickets.select', 'event_tickets.update'],
  );
});

Deno.test('handleDisputeCreated revokes the matching ticket at the door', async () => {
  // A chargeback on a ticket purchase must not leave a live QR behind: the signed token is
  // stateless, so the DB status flip IS the revocation mechanism.
  const db = makeFakeDb({ 'fund_contributions.select': [{ data: [] }] });
  await handleDisputeCreated(asDb(db), {
    payment_intent: 'pi_1',
  } as unknown as Stripe.Dispute);
  const revoke = db.calls.find((c) => c.table === 'event_tickets' && c.op === 'update');
  assert(revoke, 'expected an event_tickets update');
  assertEquals(revoke.values, { status: 'refunded', qr_token: null });
  assertEquals(revoke.filters, [
    ['eq', 'stripe_payment_id', 'pi_1'],
    ['in', 'status', ['paid', 'checked_in']],
  ]);
});

Deno.test('handleDisputeCreated pulls the contribution back out of the ticker', async () => {
  // A card chargeback or a PayPal claim both mean the money is leaving, so a dispute must
  // reverse the aggregate immediately — the ticker is public and cannot hold money we lost.
  const db = makeFakeDb({
    'fund_contributions.select': [{ data: [{ id: 'c1', edition_id: 'ed-9' }] }],
  });
  await handleDisputeCreated(asDb(db), {
    payment_intent: { id: 'pi_c1' },
  } as unknown as Stripe.Dispute);
  const [sel, upd, rpc] = db.calls;
  assertEquals(sel.filters, [
    ['eq', 'stripe_payment_intent_id', 'pi_c1'],
    ['eq', 'status', 'succeeded'],
  ]);
  assertEquals(upd.values, { status: 'refunded' });
  assert(upd.filters.some(([f, c, v]) => f === 'eq' && c === 'status' && v === 'succeeded'));
  assertEquals(rpc.values, { p_edition_id: 'ed-9' });
});

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

// ── W13: account.updated → payout_accounts cache ─────────────────────────────

const connectAccount = (over: Record<string, unknown> = {}) =>
  ({
    id: 'acct_1',
    charges_enabled: false,
    payouts_enabled: false,
    details_submitted: false,
    ...over,
  }) as unknown as Stripe.Account;

Deno.test(
  'handleAccountUpdated flips the capability flags on — and stamps onboarded_at once',
  async () => {
    const db = makeFakeDb();
    await handleAccountUpdated(
      asDb(db),
      connectAccount({ charges_enabled: true, payouts_enabled: true, details_submitted: true }),
    );
    const [flags, onboarded] = db.calls;
    assertEquals(flags.table, 'payout_accounts');
    assertEquals(flags.values, { charges_enabled: true, payouts_enabled: true });
    assertEquals(flags.filters, [['eq', 'stripe_account_id', 'acct_1']]);
    assertEquals(onboarded.table, 'payout_accounts');
    assert(
      typeof (onboarded.values as Record<string, unknown>).onboarded_at === 'string',
      'onboarded_at must be stamped when details_submitted',
    );
    // Set-once: the is-null guard is what keeps a redelivery (or a later capability
    // event) from moving the completion timestamp.
    assertEquals(onboarded.filters, [
      ['eq', 'stripe_account_id', 'acct_1'],
      ['is', 'onboarded_at', null],
    ]);
  },
);

Deno.test(
  'handleAccountUpdated flips the capability flags OFF too — the transfer gate must fail closed',
  async () => {
    // Stripe revokes as well as grants (new requirements past deadline). A grant-only handler
    // would leave #247 reading stale true flags after a revocation.
    const db = makeFakeDb();
    await handleAccountUpdated(
      asDb(db),
      connectAccount({ charges_enabled: false, payouts_enabled: false, details_submitted: true }),
    );
    assertEquals(db.calls[0].values, { charges_enabled: false, payouts_enabled: false });
  },
);

Deno.test('handleAccountUpdated coerces absent flags to false, never null', async () => {
  // Stripe types both flags optional; a null would violate the NOT NULL columns and
  // poison-loop the event.
  const db = makeFakeDb();
  await handleAccountUpdated(asDb(db), { id: 'acct_1' } as unknown as Stripe.Account);
  assertEquals(db.calls[0].values, { charges_enabled: false, payouts_enabled: false });
  assertEquals(db.calls.length, 1, 'no details_submitted → no onboarded_at write');
});

Deno.test(
  'handleAccountUpdated acks an account with no cached row (not ours / erased)',
  async () => {
    // Update-only by design: PostgREST reports a 0-row update as success, and recreating the
    // row would resurrect a hard-deleted profile's pointer. No throw = 200 = Stripe stops.
    const db = makeFakeDb();
    await handleAccountUpdated(asDb(db), connectAccount({ id: 'acct_unknown' }));
    assertEquals(db.calls.length, 1);
  },
);

Deno.test('handleAccountUpdated throws on a failed write (Stripe must retry)', async () => {
  for (const script of [
    { 'payout_accounts.update': [{ error: { message: 'boom' } }] },
    { 'payout_accounts.update': [{ error: null }, { error: { message: 'boom' } }] },
  ]) {
    const db = makeFakeDb(script);
    await assertRejects(() =>
      handleAccountUpdated(asDb(db), connectAccount({ details_submitted: true })),
    );
  }
});

// ── W14/W15: transfer.created / transfer.reversed → fund_payout_ledger (#247) ─

const fundTransfer = (over: Record<string, unknown> = {}) =>
  ({
    id: 'tr_1',
    amount: 4000,
    amount_reversed: 0,
    currency: 'eur',
    destination: 'acct_win',
    metadata: {
      kind: 'fund_payout',
      edition_id: 'ed-1',
      pool_cents: '10000',
      split_pct: '10',
      payable_cents: '9000',
    },
    ...over,
  }) as unknown as Stripe.Transfer;

Deno.test(
  'handleTransferCreated records the ledger row from the transfer + its basis',
  async () => {
    const db = makeFakeDb();
    await handleTransferCreated(asDb(db), fundTransfer());
    assertEquals(db.calls.length, 1);
    const call = db.calls[0];
    assertEquals(call.table, 'fund_payout_ledger');
    assertEquals(call.op, 'upsert');
    assertEquals(call.values, {
      edition_id: 'ed-1',
      // #231: no phase on the transfer → no attribution. Legal, and the state every
      // pre-tranche-gate release is in.
      plan_phase_id: null,
      destination_account_id: 'acct_win',
      amount_cents: 4000,
      reversed_cents: 0,
      currency: 'eur',
      pool_cents: 10000,
      split_pct: 10,
      payable_cents: 9000,
      status: 'released',
      stripe_transfer_id: 'tr_1',
    });
    // Row-level idempotency: a redelivery (or a second event id for the same transfer)
    // inserts nothing — same posture as fund_contributions.
    assertEquals(call.options, { onConflict: 'stripe_transfer_id', ignoreDuplicates: true });
  },
);

Deno.test('handleTransferCreated attributes the tranche to its plan phase (#231)', async () => {
  // The one metadata key #228 left for this issue: it is what makes a released tranche
  // attributable to the phase whose recorded verification released it. The ledger's
  // within-basis trigger then refuses a foreign cycle or an over-phase-amount row.
  const db = makeFakeDb();
  const base = fundTransfer().metadata as Record<string, string>;
  const phaseId = '22222222-2222-2222-2222-222222222222';
  await handleTransferCreated(
    asDb(db),
    fundTransfer({ metadata: { ...base, plan_phase_id: phaseId } }),
  );
  assertEquals(db.calls.length, 1);
  assertEquals((db.calls[0].values as Record<string, unknown>).plan_phase_id, phaseId);
});

Deno.test('handleTransferCreated throws on a malformed plan_phase_id (fail loud)', async () => {
  // Passing it through would surface as a bare 22P02 from a column the message never
  // names. Absent is legal (above); present-and-wrong is the misconfiguration.
  const base = fundTransfer().metadata as Record<string, string>;
  for (const bad of ['', 'not-a-uuid', '22222222-2222-2222-2222-22222222222']) {
    const db = makeFakeDb();
    await assertRejects(
      () =>
        handleTransferCreated(
          asDb(db),
          fundTransfer({ metadata: { ...base, plan_phase_id: bad } }),
        ),
      Error,
      'malformed plan_phase_id',
    );
    assertEquals(db.calls.length, 0);
  }
});

Deno.test('handleTransferCreated ignores transfers that are not fund payouts', async () => {
  // #104's ticket payouts and Dashboard manual transfers are not this arm's to record.
  const db = makeFakeDb();
  await handleTransferCreated(asDb(db), fundTransfer({ metadata: {} }));
  await handleTransferCreated(asDb(db), fundTransfer({ metadata: { kind: 'ticket_payout' } }));
  assertEquals(db.calls.length, 0);
});

Deno.test('handleTransferCreated throws on missing basis metadata (fail loud, retry)', async () => {
  // A row without its declared-retention basis cannot reconcile #234's costs against
  // #237's figures — never cache it; the unprocessed event is the standing alarm.
  const base = fundTransfer().metadata as Record<string, string>;
  for (const patch of [
    { edition_id: '' },
    { pool_cents: 'not-a-number' },
    { split_pct: '' },
    { payable_cents: '9000.5' },
  ]) {
    const db = makeFakeDb();
    await assertRejects(() =>
      handleTransferCreated(asDb(db), fundTransfer({ metadata: { ...base, ...patch } })),
    );
    assertEquals(db.calls.length, 0);
  }
  const db = makeFakeDb();
  await assertRejects(() => handleTransferCreated(asDb(db), fundTransfer({ destination: null })));
  assertEquals(db.calls.length, 0);
});

Deno.test(
  'handleTransferCreated normalises an expanded destination and throws on db error',
  async () => {
    const db = makeFakeDb();
    await handleTransferCreated(asDb(db), fundTransfer({ destination: { id: 'acct_win' } }));
    assertEquals(
      (db.calls[0].values as Record<string, unknown>).destination_account_id,
      'acct_win',
    );

    const failing = makeFakeDb({ 'fund_payout_ledger.upsert': [{ error: { message: 'boom' } }] });
    await assertRejects(() => handleTransferCreated(asDb(failing), fundTransfer()));
  },
);

Deno.test('handleTransferReversed nets the row — partial stays released, full flips', async () => {
  for (const [amountReversed, status] of [
    [1500, 'released'],
    [4000, 'reversed'],
  ] as const) {
    const db = makeFakeDb({ 'fund_payout_ledger.update': [{ data: [{ id: 'row-1' }] }] });
    await handleTransferReversed(asDb(db), fundTransfer({ amount_reversed: amountReversed }));
    const call = db.calls[0];
    assertEquals(call.table, 'fund_payout_ledger');
    assertEquals(call.op, 'update');
    assertEquals(call.values, { reversed_cents: amountReversed, status });
    assertEquals(call.filters, [['eq', 'stripe_transfer_id', 'tr_1']]);
  }
});

Deno.test(
  'handleTransferReversed: unmatched fund reversal throws, foreign reversal acks',
  async () => {
    // Stripe does not guarantee order. A fund-kind reversal landing before its
    // transfer.created must RETRY (acking would lose the reversal when the created arm
    // later inserts the pre-reversal snapshot); a transfer that is not ours just acks.
    const fund = makeFakeDb({ 'fund_payout_ledger.update': [{ data: [] }] });
    await assertRejects(
      () => handleTransferReversed(asDb(fund), fundTransfer({ amount_reversed: 4000 })),
      Error,
      'before its ledger row',
    );

    const foreign = makeFakeDb({ 'fund_payout_ledger.update': [{ data: [] }] });
    await handleTransferReversed(
      asDb(foreign),
      fundTransfer({ amount_reversed: 4000, metadata: {} }),
    );
    assertEquals(foreign.calls.length, 1); // the guarded update ran, matched nothing, acked
  },
);

Deno.test('handleTransferReversed throws on a failed write (Stripe must retry)', async () => {
  const db = makeFakeDb({ 'fund_payout_ledger.update': [{ error: { message: 'boom' } }] });
  await assertRejects(() => handleTransferReversed(asDb(db), fundTransfer()));
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
    ['charge.refunded', { payment_intent: 'pi_c1' }, 'fund_contributions'],
    ['charge.dispute.created', { payment_intent: 'pi_c1' }, 'fund_contributions'],
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
    ['account.updated', connectAccount(), 'payout_accounts'],
    ['transfer.created', fundTransfer(), 'fund_payout_ledger'],
    ['transfer.reversed', fundTransfer({ amount_reversed: 4000 }), 'fund_payout_ledger'],
  ];
  for (const [type, object, table] of cases) {
    const db = makeFakeDb({
      'fund_contributions.upsert': [{ count: 1 }],
      // transfer.reversed throws on a 0-row update for a fund transfer (out-of-order
      // guard) — script the matched row so routing stays the thing under test here.
      'fund_payout_ledger.update': [{ data: [{ id: 'row-1' }] }],
    });
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

Deno.test('processEvent refuses delayed-settlement events instead of acking them', async () => {
  // Deleting the async_payment_* cases would drop them to `default`, which acks 200 — the
  // misconfiguration would be silent on this half while assertSettled 500s on the other.
  for (const type of [
    'checkout.session.async_payment_succeeded',
    'checkout.session.async_payment_failed',
  ]) {
    const db = makeFakeDb();
    await assertRejects(
      () => processEvent(routingCtx(db), stripeEvent(type, contributionSession())),
      Error,
      'no handler by design',
    );
    assertEquals(db.calls.length, 0);
  }
});

Deno.test('processEvent ignores a subscription checkout that carries no subscription', async () => {
  const db = makeFakeDb();
  await processEvent(
    routingCtx(db),
    stripeEvent('checkout.session.completed', {
      id: 'cs_s2',
      metadata: { kind: 'subscription' },
      subscription: null,
    }),
  );
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
    // count 1 = the ticket row was inserted. Scripted rather than left to the fake's `null`
    // default, because an indeterminate count deliberately skips the #522 mirror — this test
    // is about the pipeline around a ticket that really was issued.
    'event_tickets.upsert': [{ count: 1 }],
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
    'rsvps.upsert', // #522 — the mirror rides INSIDE the lease, before the completion stamp
    'stripe_webhook_events.update', // completion stamp AFTER successful processing
  ]);
  const ourClaim = (db.calls[1].values as Record<string, unknown>).claimed_at;
  assert(ourClaim);
  assert((db.calls[4].values as Record<string, unknown>).processed_at);
  // the completion stamp is guarded on OUR lease — never stamps over a re-claim
  assertEquals(db.calls[4].filters, [
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

const subscriptionCheckout = () =>
  ({
    id: 'cs_s1',
    created: 1751000000,
    payment_status: 'paid',
    metadata: { kind: 'subscription', profile_id: 'prof-1' },
    subscription: 'sub_1',
  }) as unknown as Stripe.Checkout.Session;

const identitySession = () =>
  ({
    id: 'vs_1',
    status: 'verified',
    metadata: { profile_id: 'prof-1' },
  }) as unknown as Stripe.Identity.VerificationSession;

/**
 * Every surface through which Aura can be granted. `aura_events` is the append-only ledger and
 * `aura_scores` the projection (docs/PRD.md:394, docs/PRD.md:398); a `SECURITY DEFINER` rpc whose
 * name mentions aura/score would be the other way in. WebhookCtx injects no score-engine
 * capability, so a score event originating in this function has to appear here.
 */
const scoreWrites = (db: FakeDb): FakeCall[] =>
  db.calls.filter((c) =>
    c.op === 'rpc'
      ? /aura|score/i.test(String(c.columns ?? ''))
      : c.op !== 'select' && /^aura_(events|scores)$/.test(c.table),
  );

const MONEY_TABLES = [
  'event_tickets',
  'fund_contributions',
  'circle_memberships',
  'payout_accounts',
];
const moneyWrites = (db: FakeDb) =>
  db.calls.filter((c) => c.op !== 'select' && MONEY_TABLES.includes(c.table));

// ═══ A. Anti-buyability — the money side of "Aura is never purchasable" ═══════
//
// docs/PRD.md:191 — "Aura never purchasable. Athanor Circle membership and fund contributions
// yield **zero** points. Enforced in engine, asserted in tests." The engine half lives in
// packages/core; THIS is the webhook half, and it is the half where money actually arrives.
// docs/PRD.md:386 and :387 give the fund and subscription branches exactly one destination each
// (fund_contributions, circle_memberships) — no score event is listed for either.
// docs/PRD.md:220 — Circle is "never: score boost".

Deno.test('paying money writes ZERO score events, on every paying branch', async () => {
  // Ticket is in the list on purpose: docs/PRD.md:153 and :181 grant +15 for *checked-in
  // attendance*, not for the purchase. Buying a ticket and never showing up must be worth 0.
  const cases: [string, string, unknown][] = [
    ['fund contribution', 'checkout.session.completed', contributionSession()],
    ['ticket purchase', 'checkout.session.completed', ticketSession()],
    ['circle checkout', 'checkout.session.completed', subscriptionCheckout()],
    ['circle created', 'customer.subscription.created', subscription()],
    ['circle updated', 'customer.subscription.updated', subscription()],
    ['circle deleted', 'customer.subscription.deleted', subscription({ status: 'canceled' })],
    ['circle invoice failed', 'invoice.payment_failed', { subscription: 'sub_1' }],
    // Completing payout KYC is the last step before money can reach a member — if any
    // paying-adjacent branch were going to leak Aura, it is this one (rule #1).
    [
      'payout account update',
      'account.updated',
      connectAccount({ charges_enabled: true, payouts_enabled: true, details_submitted: true }),
    ],
  ];
  for (const [label, type, object] of cases) {
    const db = makeFakeDb({
      'fund_contributions.upsert': [{ count: 1 }],
      'event_tickets.upsert': [{ count: 1 }],
    });
    await processEvent(routingCtx(db), stripeEvent(type, object));
    assertEquals(
      scoreWrites(db).map((c) => `${c.table}.${c.op}`),
      [],
      `${label}: money must never mint Aura (docs/PRD.md:191)`,
    );
  }
});

Deno.test('identity.verified produces its score event only via the profile flip', async () => {
  // docs/PRD.md:388 — "identity.verified → verifications → badge + score event".
  // docs/PRD.md:180 — "Identity verified +50, once".
  //
  // The webhook does exactly two things — cache `verifications` and flip
  // `profiles.identity_verified`. The +50 is minted a layer down by the `profiles_aura_identity`
  // trigger, which keeps the award unreachable from any client (rule #1) but means the one
  // money→Aura path the PRD permits is not self-evidencing here. Its cross-layer half lives in
  // _shared/aura-boundary.test.ts.
  const db = makeFakeDb();
  await processEvent(
    routingCtx(db),
    stripeEvent('identity.verification_session.verified', identitySession()),
  );
  assertEquals(scoreWrites(db), [], 'the webhook itself must not write the ledger directly');
  const flip = db.calls.find((c) => c.table === 'profiles');
  assert(flip, 'without the profiles flip there is no trigger input and the +50 never happens');
  assertEquals((flip.values as Record<string, unknown>).identity_verified, true);
});

Deno.test('a FAILED identity check writes no score event', async () => {
  // docs/PRD.md:388 attaches the score event to `identity.verified` alone; requires_input is
  // the not-verified terminal state, so awarding there would make +50 retryable.
  const db = makeFakeDb();
  await processEvent(
    routingCtx(db),
    stripeEvent('identity.verification_session.requires_input', identitySession()),
  );
  assertEquals(scoreWrites(db), []);
});

// ═══ B. Branch isolation — one destination per branch ═════════════════════════
//
// docs/PRD.md:385-388 map each event to exactly one money table. Asserting only that the first
// call lands on the right table would miss a branch that *also* touches another ledger, which
// is what a `kind` typo or a fallthrough produces.

Deno.test('each money branch touches its own ledger and no other', async () => {
  const cases: [string, string, unknown, string][] = [
    ['ticket', 'checkout.session.completed', ticketSession(), 'event_tickets'],
    ['fund', 'checkout.session.completed', contributionSession(), 'fund_contributions'],
    ['circle checkout', 'checkout.session.completed', subscriptionCheckout(), 'circle_memberships'],
    ['circle sub', 'customer.subscription.updated', subscription(), 'circle_memberships'],
    [
      'payout account',
      'account.updated',
      connectAccount({ details_submitted: true }),
      'payout_accounts',
    ],
  ];
  for (const [label, type, object, own] of cases) {
    const db = makeFakeDb({
      'fund_contributions.upsert': [{ count: 1 }],
      'event_tickets.upsert': [{ count: 1 }],
    });
    await processEvent(routingCtx(db), stripeEvent(type, object));
    const touched = [...new Set(moneyWrites(db).map((c) => c.table))];
    assertEquals(touched, [own], `${label}: docs/PRD.md:385-388 give this branch one destination`);
  }
});

Deno.test('a completed checkout with an unknown kind writes to no money ledger', async () => {
  // docs/PRD.md:385-387 enumerate three checkout kinds. A fourth means money arrived that this
  // webhook cannot classify — it must not be guessed into one of the three books.
  const db = makeFakeDb({
    'fund_contributions.upsert': [{ count: 1 }],
    'event_tickets.upsert': [{ count: 1 }],
  });
  await processEvent(
    routingCtx(db),
    stripeEvent(
      'checkout.session.completed',
      ticketSession({ metadata: { kind: 'merch', profile_id: 'prof-1' } }),
    ),
  ).catch(() => {}); // throwing is an acceptable outcome; writing to a ledger is not
  assertEquals(moneyWrites(db), []);
});

// ═══ C. Signature verification over the RAW body ═════════════════════════════
//
// docs/PRD.md:406 — "Webhooks signature-verified + idempotent". The signature covers the exact
// bytes Stripe sent, so a reserialization before verifying would check a payload that never
// arrived — a distinct failure from the bad-signature rejection asserted above.

Deno.test('handleWebhook verifies the exact bytes it received, not a reserialization', async () => {
  const body = '{"id":"evt_1","type":"payment_intent.created","spacing":  "preserved"}';
  const sig = 't=1751000000,v1=deadbeef';
  const seen: unknown[][] = [];
  const db = makeFakeDb();
  const ctx: WebhookCtx = {
    db: asDb(db),
    qrSecret: SECRET,
    verifyEvent: ((...args: unknown[]) => {
      seen.push(args);
      return Promise.resolve(stripeEvent('payment_intent.created', {}));
    }) as WebhookCtx['verifyEvent'],
    retrieveSubscription: () => Promise.resolve(subscription()),
  };
  const headers = new Headers({ 'stripe-signature': sig });
  await handleWebhook(
    ctx,
    new Request('http://localhost/stripe-webhook', {
      method: 'POST',
      headers,
      body,
    }),
  );

  assertEquals(seen.length, 1, 'verifyEvent must be called exactly once');
  assert(
    seen[0].includes(body),
    `raw body must reach the verifier byte-identical; got ${JSON.stringify(seen[0])}`,
  );
  assert(seen[0].includes(sig), 'the stripe-signature header value must reach the verifier');
});

// ═══ D. Idempotency keyed on Stripe's event id ═══════════════════════════════
//
// docs/PRD.md:358 — "stripe_webhook_events (event_id unique → idempotency)".
// docs/PRD.md:384 — "dedup on stripe_webhook_events.event_id".
// docs/PRD.md:155 — "webhook-confirmed, idempotent".

Deno.test('the ledger row is keyed on the Stripe event id', async () => {
  const db = makeFakeDb({
    'stripe_webhook_events.update': [{ data: [{ event_id: 'evt_XYZ' }] }, { data: [{}] }],
  });
  const ctx: WebhookCtx = {
    db: asDb(db),
    qrSecret: SECRET,
    verifyEvent: () =>
      Promise.resolve(stripeEvent('checkout.session.completed', ticketSession(), 'evt_XYZ')),
    retrieveSubscription: () => Promise.resolve(subscription()),
  };
  await handleWebhook(
    ctx,
    new Request('http://localhost/stripe-webhook', {
      method: 'POST',
      headers: new Headers({ 'stripe-signature': 'sig_ok' }),
      body: '{}',
    }),
  );
  const ledger = db.calls[0];
  assertEquals(ledger.table, 'stripe_webhook_events');
  assertEquals((ledger.values as Record<string, unknown>).event_id, 'evt_XYZ');
  // dedupe is on the event id, never on the payment intent (one PI can produce many events)
  assertEquals(
    (ledger.options as Record<string, unknown> | undefined)?.onConflict ?? 'event_id',
    'event_id',
  );
});

Deno.test('the same event delivered twice buys exactly one ticket', async () => {
  // The composed claim behind docs/PRD.md:384: each phase is proven in isolation above (claim
  // won / claim lost + processed_at set); this is the money-visible consequence of running both
  // back to back against one ledger row.
  const db = makeFakeDb({
    'stripe_webhook_events.update': [
      { data: [{ event_id: 'evt_1' }] }, // delivery 1: lease claim won
      { data: [{ event_id: 'evt_1' }] }, // delivery 1: processed_at stamp
      { data: [] }, // delivery 2: claim lost — row already processed
    ],
    'stripe_webhook_events.select': [{ data: { processed_at: '2026-08-01T00:00:00Z' } }],
    'event_tickets.upsert': [{ count: 1 }],
  });
  const ctx: WebhookCtx = {
    db: asDb(db),
    qrSecret: SECRET,
    verifyEvent: () => Promise.resolve(stripeEvent('checkout.session.completed', ticketSession())),
    retrieveSubscription: () => Promise.resolve(subscription()),
  };
  const req = () =>
    new Request('http://localhost/stripe-webhook', {
      method: 'POST',
      headers: new Headers({ 'stripe-signature': 'sig_ok' }),
      body: '{}',
    });

  const first = await handleWebhook(ctx, req());
  const second = await handleWebhook(ctx, req());
  assertEquals([first.status, second.status], [200, 200], 'both deliveries must be acked');
  assertEquals(
    db.calls.filter((c) => c.table === 'event_tickets').length,
    1,
    'a redelivered event must not issue a second ticket (docs/PRD.md:384)',
  );
});
