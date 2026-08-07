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

const eventRow = (over: Record<string, unknown> = {}) => ({
  id: EVENT,
  title: 'Cena alchemica',
  price_cents: 1500,
  currency: 'eur',
  organizer_id: 'org-1',
  deleted_at: null,
  ...over,
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

// ── session params + happy path ──────────────────────────────────────────────

Deno.test(
  'happy path → { url }; price from the DB row, profile_id from the verified arg',
  async () => {
    const c = ctx({
      'events.select': [{ data: eventRow() }],
      'rpc.is_identity_verified': [{ data: true }],
    });
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
  );
  assertEquals(params.metadata, { kind: 'ticket', event_id: 'evt-9', profile_id: 'prof-9' });
  assertEquals(params.line_items?.[0].price_data?.unit_amount, 700);
  assertEquals(params.success_url, 'https://app.example/event/evt-9?checkout=success');
  assertEquals(params.cancel_url, 'https://app.example/event/evt-9?checkout=cancel');
});

Deno.test('session without url / Stripe throw → clean 500, never Stripe internals', async () => {
  const script = () => ({
    'events.select': [{ data: eventRow() }],
    'rpc.is_identity_verified': [{ data: true }],
  });
  const noUrl = await run(ctx(script(), { sessionUrl: null }));
  assertEquals(noUrl.res.status, 500);
  assertEquals(noUrl.body, { error: 'could not start checkout' });

  const thrown = await run(ctx(script(), { throwOnCreate: true }));
  assertEquals(thrown.res.status, 500);
  assertEquals(thrown.body, { error: 'could not start checkout' });
});
