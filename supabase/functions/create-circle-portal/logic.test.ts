// deno test supabase/functions/create-circle-portal/ — runs in CI (edge job) and locally.
// Characterization tests for the portal membership gate, the #759 Customer fallback, and params.
// All db I/O through injected fakes; Stripe as capability closures (DI over mocks).
import { assert, assertEquals } from 'jsr:@std/assert@1';
// stripe pinned to major 22: deno.lock is gitignored, so CI resolves fresh on every
// run — an unpinned specifier would typecheck against latest and redden on SDK majors.
import type Stripe from 'npm:stripe@22';
import { makeFakeDb, type FakeDb, type FakeResult } from '../_shared/fake-db.ts';
import { createCirclePortal, type CirclePortalCtx } from './logic.ts';

// A uuid, as getUser() returns one — the #759 tag search refuses anything else.
const PROFILE = '6f1c2d3e-4a5b-4c6d-8e7f-9a0b1c2d3e4f';

type Ctx = CirclePortalCtx & {
  db: FakeDb;
  created: Stripe.BillingPortal.SessionCreateParams[];
  /** what each #759 Stripe listing was asked about */
  emailsListed: string[];
  tagQueries: string[];
  subscriptionsListedFor: string[];
};

const stripeCustomer = (id: string, profileId?: string, created = 100): Stripe.Customer =>
  ({
    id,
    created,
    metadata: profileId ? { profile_id: profileId } : {},
  }) as unknown as Stripe.Customer;

const ctx = (
  script: Record<string, FakeResult[]> = {},
  opts: {
    throwOnCreate?: boolean;
    customersByEmail?: Stripe.Customer[] | Error;
    customersByTag?: Stripe.Customer[] | Error;
    /** non-canceled subscriptions by status, per Customer id */
    subscriptionsBy?: Record<string, string[]>;
    subscriptionsFail?: boolean;
  } = {},
): Ctx => {
  const db = makeFakeDb(script);
  const created: Stripe.BillingPortal.SessionCreateParams[] = [];
  const emailsListed: string[] = [];
  const tagQueries: string[] = [];
  const subscriptionsListedFor: string[] = [];
  return {
    userClient: db as unknown as CirclePortalCtx['userClient'],
    listCustomersByEmail: (email) => {
      emailsListed.push(email);
      const found = opts.customersByEmail ?? [];
      return found instanceof Error ? Promise.reject(found) : Promise.resolve(found);
    },
    searchCustomersByTag: (query) => {
      tagQueries.push(query);
      const found = opts.customersByTag ?? [];
      return found instanceof Error ? Promise.reject(found) : Promise.resolve(found);
    },
    listSubscriptions: (customerId) => {
      subscriptionsListedFor.push(customerId);
      if (opts.subscriptionsFail) return Promise.reject(new Error('stripe down'));
      return Promise.resolve(
        (opts.subscriptionsBy?.[customerId] ?? []).map(
          (status, i) => ({ id: `sub_${i}`, status }) as unknown as Stripe.Subscription,
        ),
      );
    },
    createPortalSession: (params) => {
      created.push(params);
      if (opts.throwOnCreate) return Promise.reject(new Error('stripe down'));
      return Promise.resolve({
        url: 'https://billing.stripe.test/ps_1',
      } as Stripe.BillingPortal.Session);
    },
    appBase: 'athanor://',
    db,
    created,
    emailsListed,
    tagQueries,
    subscriptionsListedFor,
  };
};

const run = async (c: Ctx) => {
  const res = await createCirclePortal(c, { profileId: PROFILE });
  return { res, body: await res.json() };
};

Deno.test('membership lookup error → 500', async () => {
  const c = ctx({ 'circle_memberships.select': [{ error: { message: 'boom' } }] });
  const { res, body } = await run(c);
  assertEquals(res.status, 500);
  assertEquals(body, { error: 'membership lookup failed' });
  assertEquals(c.created.length, 0);
});

Deno.test('no membership row / null customer id, nothing tagged → 404, no portal', async () => {
  for (const scripted of [{ data: null }, { data: { stripe_customer_id: null } }]) {
    const c = ctx({ 'circle_memberships.select': [scripted] });
    const { res, body } = await run(c);
    assertEquals(res.status, 404);
    assertEquals(body, { error: 'no membership' });
    assertEquals(c.created.length, 0);
    assertEquals(c.emailsListed, [], 'no email to list by');
  }
});

Deno.test('happy path → { url }; own-row read, portal params shape', async () => {
  const c = ctx({ 'circle_memberships.select': [{ data: { stripe_customer_id: 'cus_1' } }] });
  const { res, body } = await run(c);
  assertEquals(res.status, 200);
  assertEquals(body, { url: 'https://billing.stripe.test/ps_1' });

  // membership read is scoped to the caller (RLS select-own mirrors this).
  const q = c.db.calls[0];
  assertEquals(q.table, 'circle_memberships');
  assertEquals(q.columns, 'stripe_customer_id');
  assert(q.filters.some(([f, col, v]) => f === 'eq' && col === 'profile_id' && v === PROFILE));

  assertEquals(c.created, [{ customer: 'cus_1', return_url: 'athanor://circle?portal=return' }]);
});

Deno.test('portal create throw → clean 500, never Stripe internals', async () => {
  const c = ctx(
    { 'circle_memberships.select': [{ data: { stripe_customer_id: 'cus_1' } }] },
    { throwOnCreate: true },
  );
  const { res, body } = await run(c);
  assertEquals(res.status, 500);
  assertEquals(body, { error: 'could not open portal' });
});

// ── #759: before the first webhook lands ─────────────────────────────────────────
// create-circle-checkout refuses a second subscription with «manage it from here», and that
// refusal can come before the webhook has written the row this function used to depend on alone —
// the member who paid and tapped Join again. The portal must open on the Customer Stripe holds.

const EMAIL = 'seeker@example.com';
const runWithEmail = async (c: Ctx) => {
  const res = await createCirclePortal(c, { profileId: PROFILE, email: EMAIL });
  return { res, body: await res.json() };
};
const noRow = () => ({ 'circle_memberships.select': [{ data: null }] });

Deno.test('#759 no row yet → the portal opens on the Customer tagged with the caller', async () => {
  const c = ctx(noRow(), {
    customersByEmail: [stripeCustomer('cus_else', 'prof-9'), stripeCustomer('cus_tagged', PROFILE)],
  });
  const { res, body } = await runWithEmail(c);
  assertEquals(res.status, 200);
  assertEquals(body, { url: 'https://billing.stripe.test/ps_1' });
  assertEquals(c.emailsListed, [EMAIL]);
  assertEquals(c.created, [
    { customer: 'cus_tagged', return_url: 'athanor://circle?portal=return' },
  ]);
});

Deno.test('#759 no row and no tagged Customer → 404, no portal', async () => {
  // An email match alone is someone else's Customer — only the server-written tag says whose.
  const c = ctx(noRow(), {
    customersByEmail: [stripeCustomer('cus_untagged'), stripeCustomer('cus_old', 'prof-0')],
  });
  const { res, body } = await runWithEmail(c);
  assertEquals(res.status, 404);
  assertEquals(body, { error: 'no membership' });
  assertEquals(c.created, []);
});

Deno.test('#759 a row still wins — Stripe’s Customers are not listed or searched', async () => {
  const c = ctx({ 'circle_memberships.select': [{ data: { stripe_customer_id: 'cus_1' } }] });
  await runWithEmail(c);
  assertEquals(c.emailsListed, []);
  assertEquals(c.tagQueries, []);
  assertEquals(c.created[0].customer, 'cus_1');
});

Deno.test('#759 any listing failing → clean 500, no portal', async () => {
  for (const opts of [
    { customersByEmail: new Error('stripe down') },
    { customersByTag: new Error('stripe down') },
    {
      customersByEmail: [stripeCustomer('cus_a', PROFILE, 300)],
      customersByTag: [stripeCustomer('cus_b', PROFILE, 100)],
      subscriptionsFail: true,
    },
  ]) {
    const c = ctx(noRow(), opts);
    const { res, body } = await runWithEmail(c);
    assertEquals(res.status, 500, JSON.stringify(Object.keys(opts)));
    assertEquals(body, { error: 'could not open portal' });
    assertEquals(c.created, []);
  }
});

Deno.test('#759 an email changed since: the tag search still finds the Customer', async () => {
  const c = ctx(noRow(), { customersByTag: [stripeCustomer('cus_old_email', PROFILE)] });
  const { res } = await runWithEmail(c);
  assertEquals(res.status, 200);
  assertEquals(c.tagQueries, [`metadata['profile_id']:'${PROFILE}'`]);
  assertEquals(c.created[0].customer, 'cus_old_email');
});

Deno.test('#759 several tagged Customers → the one holding a live subscription', async () => {
  // The portal is where a live subscription is managed; the newest Customer may hold none.
  const c = ctx(noRow(), {
    customersByEmail: [stripeCustomer('cus_newer', PROFILE, 300)],
    customersByTag: [stripeCustomer('cus_older', PROFILE, 100)],
    subscriptionsBy: { cus_newer: ['canceled'], cus_older: ['past_due'] },
  });
  const { res } = await runWithEmail(c);
  assertEquals(res.status, 200);
  assertEquals(c.created[0].customer, 'cus_older');

  // None live → the newest.
  const none = ctx(noRow(), {
    customersByEmail: [stripeCustomer('cus_newer', PROFILE, 300)],
    customersByTag: [stripeCustomer('cus_older', PROFILE, 100)],
  });
  await runWithEmail(none);
  assertEquals(none.created[0].customer, 'cus_newer');
});
