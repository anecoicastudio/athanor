// deno test supabase/functions/create-ticket-checkout/ — runs in CI (edge job) and locally.
// Characterization tests for the ticket-checkout guard ladder + session params.
// All db I/O through injected fakes; Stripe as a capability closure (DI over mocks).
import { assert, assertEquals } from 'jsr:@std/assert@1';
// stripe pinned to major 22: deno.lock is gitignored, so CI resolves fresh on every
// run — an unpinned specifier would typecheck against latest and redden on SDK majors.
import type Stripe from 'npm:stripe@22';
import { makeFakeDb, type FakeDb, type FakeResult } from '../_shared/fake-db.ts';
import { buildTicketSessionParams, createTicketCheckout, type TicketCheckoutCtx } from './logic.ts';

const PROFILE = 'prof-1';
const EVENT = 'evt-1';
const APP = 'athanor://';
/** Fixed clock — the past-event guard is time-dependent, so it is injected, never read. */
const NOW = new Date('2026-08-11T12:00:00Z');

const eventRow = (over: Record<string, unknown> = {}) => ({
  id: EVENT,
  title: 'Cena alchemica',
  price_cents: 1500,
  currency: 'eur',
  organizer_id: 'org-1',
  starts_at: '2026-08-20T18:00:00Z', // future relative to NOW
  ends_at: null,
  deleted_at: null,
  ...over,
});

/** Event loaded + organizer verified + seat claimable — the state the later guards run in. */
const sellable = (over: Record<string, unknown> = {}): Record<string, FakeResult[]> => ({
  'events.select': [{ data: eventRow(over) }],
  'rpc.is_identity_verified': [{ data: true }],
  'rpc.claim_event_seat': [{ data: 'claimed' }],
});

type Ctx = TicketCheckoutCtx & {
  db: FakeDb;
  created: Stripe.Checkout.SessionCreateParams[];
};

const ctx = (
  script: Record<string, FakeResult[]> = {},
  opts: { sessionUrl?: string | null; throwOnCreate?: boolean } = {},
): Ctx => {
  const db = makeFakeDb(script);
  const created: Stripe.Checkout.SessionCreateParams[] = [];
  return {
    userClient: db as unknown as TicketCheckoutCtx['userClient'],
    createCheckoutSession: (params) => {
      created.push(params);
      if (opts.throwOnCreate) return Promise.reject(new Error('stripe down'));
      return Promise.resolve({
        url: opts.sessionUrl === undefined ? 'https://checkout.stripe.test/cs_1' : opts.sessionUrl,
      } as Stripe.Checkout.Session);
    },
    appBase: APP,
    now: () => NOW,
    db,
    created,
  };
};

const run = async (c: Ctx, eventId = EVENT) => {
  const res = await createTicketCheckout(c, { profileId: PROFILE, eventId });
  return { res, body: await res.json() };
};

// ── event load + price guard ─────────────────────────────────────────────────

Deno.test('event lookup error → 500; missing event → 404', async () => {
  const err = ctx({ 'events.select': [{ error: { message: 'boom' } }] });
  const errRun = await run(err);
  assertEquals(errRun.res.status, 500);
  assertEquals(errRun.body, { error: 'event lookup failed' });

  const missing = ctx({ 'events.select': [{ data: null }] });
  const missRun = await run(missing);
  assertEquals(missRun.res.status, 404);
  assertEquals(missRun.body, { error: 'event not found' });
});

Deno.test('free event (0 / null price) → 400, Stripe never called', async () => {
  for (const price_cents of [0, null]) {
    const c = ctx({ 'events.select': [{ data: eventRow({ price_cents }) }] });
    const { res, body } = await run(c);
    assertEquals(res.status, 400);
    assertEquals(body, { error: 'event is free' });
    assertEquals(c.created.length, 0);
  }
});

Deno.test('event queried by the given id and deleted_at null', async () => {
  const c = ctx({ 'events.select': [{ data: null }] });
  await run(c, 'evt-OTHER');
  const q = c.db.calls[0];
  assertEquals(q.table, 'events');
  assert(q.filters.some(([f, col, v]) => f === 'eq' && col === 'id' && v === 'evt-OTHER'));
  assert(q.filters.some(([f, col, v]) => f === 'is' && col === 'deleted_at' && v === null));
});

// ── organizer identity gate (fail-closed) ────────────────────────────────────

Deno.test('verification rpc error → 500 fail-closed, Stripe never called', async () => {
  const c = ctx({
    'events.select': [{ data: eventRow() }],
    'rpc.is_identity_verified': [{ error: { message: 'boom' } }],
  });
  const { res, body } = await run(c);
  assertEquals(res.status, 500);
  assertEquals(body, { error: 'organizer verification lookup failed' });
  assertEquals(c.created.length, 0);
});

Deno.test('organizer not verified (false / null) → 403, Stripe never called', async () => {
  for (const data of [false, null]) {
    const c = ctx({
      'events.select': [{ data: eventRow() }],
      'rpc.is_identity_verified': [{ data }],
    });
    const { res, body } = await run(c);
    assertEquals(res.status, 403);
    assertEquals(body, { error: 'organizer not verified' });
    assertEquals(c.created.length, 0);
  }
});

Deno.test('rpc is called with the event organizer uid, not the caller', async () => {
  const c = ctx({
    'events.select': [{ data: eventRow() }],
    'rpc.is_identity_verified': [{ data: true }],
  });
  await run(c);
  const rpc = c.db.calls.find((call) => call.op === 'rpc');
  assert(rpc);
  assertEquals(rpc.columns, 'is_identity_verified');
  assertEquals(rpc.values, { uid: 'org-1' });
});

// ── self-purchase guard (#116) ───────────────────────────────────────────────

Deno.test('organizer buying their own event → 403, Stripe never called', async () => {
  const c = ctx(sellable({ organizer_id: PROFILE }));
  const { res, body } = await run(c);
  assertEquals(res.status, 403);
  assertEquals(body, { error: 'organizer cannot buy' });
  assertEquals(c.created.length, 0);
  // Refused from the row already in hand — no ticket lookup spent on it.
  assert(!c.db.calls.some((call) => call.table === 'event_tickets'));
});

// ── past-event guard (#116) ──────────────────────────────────────────────────

Deno.test('event already ended → 410, Stripe never called', async () => {
  const ended = [
    { starts_at: '2026-08-01T18:00:00Z', ends_at: '2026-08-01T22:00:00Z' }, // ends_at is past
    { starts_at: '2026-08-10T18:00:00Z', ends_at: null }, // no ends_at → starts_at decides
  ];
  for (const over of ended) {
    const c = ctx(sellable(over));
    const { res, body } = await run(c);
    assertEquals(res.status, 410);
    assertEquals(body, { error: 'event ended' });
    assertEquals(c.created.length, 0);
  }
});

Deno.test('an event under way (started, not ended) still sells', async () => {
  const c = ctx(sellable({ starts_at: '2026-08-11T10:00:00Z', ends_at: '2026-08-11T23:00:00Z' }));
  const { res } = await run(c);
  assertEquals(res.status, 200);
  assertEquals(c.created.length, 1);
});

// ── duplicate-purchase guard (#116) ──────────────────────────────────────────

Deno.test(
  'caller already holds a paid / checked_in ticket → 409, Stripe never called',
  async () => {
    for (const status of ['paid', 'checked_in']) {
      const c = ctx({ ...sellable(), 'event_tickets.select': [{ data: { status } }] });
      const { res, body } = await run(c);
      assertEquals(res.status, 409);
      assertEquals(body, { error: 'ticket already owned' });
      assertEquals(c.created.length, 0);
    }
  },
);

Deno.test('a refunded or pending row is not a held ticket — checkout proceeds', async () => {
  // refunded: the webhook's repair path (handlers.ts) re-issues on a NEW payment intent.
  // pending: never paid, so nothing was owned.
  for (const status of ['refunded', 'pending']) {
    const c = ctx({ ...sellable(), 'event_tickets.select': [{ data: { status } }] });
    const { res } = await run(c);
    assertEquals(res.status, 200);
    assertEquals(c.created.length, 1);
  }
});

Deno.test('ticket lookup error → 500 fail-closed, Stripe never called', async () => {
  const c = ctx({ ...sellable(), 'event_tickets.select': [{ error: { message: 'boom' } }] });
  const { res, body } = await run(c);
  assertEquals(res.status, 500);
  assertEquals(body, { error: 'ticket lookup failed' });
  assertEquals(c.created.length, 0);
});

Deno.test('ticket lookup is scoped to the verified caller and this event', async () => {
  const c = ctx(sellable());
  await run(c);
  const q = c.db.calls.find((call) => call.table === 'event_tickets');
  assert(q);
  // user_id is the verified profileId (getUser), never anything from the body.
  assert(q.filters.some(([f, col, v]) => f === 'eq' && col === 'user_id' && v === PROFILE));
  assert(q.filters.some(([f, col, v]) => f === 'eq' && col === 'event_id' && v === EVENT));
});

// ── session params + happy path ──────────────────────────────────────────────

Deno.test(
  'happy path → { url }; price from the DB row, profile_id from the verified arg',
  async () => {
    const c = ctx(sellable());
    const { res, body } = await run(c);
    assertEquals(res.status, 200);
    assertEquals(body, { url: 'https://checkout.stripe.test/cs_1' });

    assertEquals(c.created.length, 1);
    const params = c.created[0];
    assertEquals(params.mode, 'payment');
    // unit_amount comes from the event ROW (1500) — a client-supplied amount can never reach Stripe.
    assertEquals(params.line_items, [
      {
        quantity: 1,
        price_data: {
          currency: 'eur',
          unit_amount: 1500,
          product_data: { name: 'Cena alchemica' },
        },
      },
    ]);
    assertEquals(params.metadata, { kind: 'ticket', event_id: EVENT, profile_id: PROFILE });
    assertEquals(params.success_url, `athanor://event/${EVENT}?checkout=success`);
    assertEquals(params.cancel_url, `athanor://event/${EVENT}?checkout=cancel`);
  },
);

Deno.test('buildTicketSessionParams is pure: metadata.kind ticket, ids from args', () => {
  const params = buildTicketSessionParams(
    { id: 'evt-9', title: 'Rito', price_cents: 700, currency: 'eur' },
    'prof-9',
    'https://app.example/',
    NOW.getTime(),
  );
  assertEquals(params.metadata, { kind: 'ticket', event_id: 'evt-9', profile_id: 'prof-9' });
  assertEquals(params.line_items?.[0].price_data?.unit_amount, 700);
  assertEquals(params.success_url, 'https://app.example/event/evt-9?checkout=success');
  assertEquals(params.cancel_url, 'https://app.example/event/evt-9?checkout=cancel');
});

Deno.test(
  'the Session expires 30 minutes out (Stripe minimum) — inside the 35-minute claim',
  async () => {
    const c = ctx(sellable());
    await run(c);
    assertEquals(c.created[0].expires_at, Math.floor(NOW.getTime() / 1000) + 30 * 60);
  },
);

Deno.test('session without url / Stripe throw → clean 500, never Stripe internals', async () => {
  const noUrl = await run(ctx(sellable(), { sessionUrl: null }));
  assertEquals(noUrl.res.status, 500);
  assertEquals(noUrl.body, { error: 'could not start checkout' });

  const thrown = await run(ctx(sellable(), { throwOnCreate: true }));
  assertEquals(thrown.res.status, 500);
  assertEquals(thrown.body, { error: 'could not start checkout' });
});

// ── capacity claim (#105) ────────────────────────────────────────────────────

Deno.test('sold out → 409, Stripe never called', async () => {
  const c = ctx({ ...sellable(), 'rpc.claim_event_seat': [{ data: 'sold_out' }] });
  const { res, body } = await run(c);
  assertEquals(res.status, 409);
  assertEquals(body, { error: 'sold out' });
  assertEquals(c.created.length, 0);
});

Deno.test('claim rpc error or unknown verdict → 500 fail-closed, Stripe never called', async () => {
  for (const scripted of [{ error: { message: 'boom' } }, { data: null }, { data: 'weird' }]) {
    const c = ctx({ ...sellable(), 'rpc.claim_event_seat': [scripted as FakeResult] });
    const { res, body } = await run(c);
    assertEquals(res.status, 500);
    assertEquals(body, { error: 'seat claim failed' });
    assertEquals(c.created.length, 0);
  }
});

Deno.test('claim belt: already_owned → 409, not_found → 404', async () => {
  const owned = await run(
    ctx({ ...sellable(), 'rpc.claim_event_seat': [{ data: 'already_owned' }] }),
  );
  assertEquals(owned.res.status, 409);
  assertEquals(owned.body, { error: 'ticket already owned' });

  const gone = await run(ctx({ ...sellable(), 'rpc.claim_event_seat': [{ data: 'not_found' }] }));
  assertEquals(gone.res.status, 404);
  assertEquals(gone.body, { error: 'event not found' });
});

Deno.test('the claim is for THIS event and runs before the Stripe call', async () => {
  const c = ctx(sellable());
  await run(c);
  const claim = c.db.calls.find((call) => call.op === 'rpc' && call.columns === 'claim_event_seat');
  assert(claim);
  assertEquals(claim.values, { p_event_id: EVENT });
  assertEquals(c.created.length, 1); // claim verdict gated the call, so order held
});

Deno.test('a Stripe failure releases the claimed seat (best-effort)', async () => {
  for (const opts of [{ sessionUrl: null }, { throwOnCreate: true }] as const) {
    const c = ctx(sellable(), opts);
    await run(c);
    const release = c.db.calls.find(
      (call) => call.op === 'rpc' && call.columns === 'release_event_seat',
    );
    assert(release, 'release_event_seat called');
    assertEquals(release.values, { p_event_id: EVENT });
  }
});

Deno.test('a successful checkout releases nothing — the webhook pays the claim', async () => {
  const c = ctx(sellable());
  await run(c);
  assert(!c.db.calls.some((call) => call.columns === 'release_event_seat'));
});
