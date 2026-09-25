// deno test supabase/functions/erasure-job/ — runs in CI (edge job) and locally.
//
// The transport half of erasure step (3b-ter), #763: clearing `metadata.profile_id` off the
// member's Stripe Customers. ./logic.test.ts mocks the port and pins what the LOOP does with an
// untag outcome; this file pins which Customers the port touches and how, against a fake of the
// three SDK calls it uses. index.ts is a `Deno.serve` shell no test executes (#542), so the
// wiring lives here where one can.
import { assertEquals, assertRejects } from 'jsr:@std/assert@1';
import { type CustomerTagApi, customerUntagger } from './untag.ts';

const PROFILE_ID = '3f1c7a52-1b0e-4a6f-9f0b-2c4d5e6f7a8b';
const OTHER_ID = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';

type FakeCustomer = { id: string; deleted?: boolean; metadata?: Record<string, string> };

/**
 * A Stripe that holds Customers and answers the three calls. `search` returns whatever is tagged
 * with the queried id at call time — Stripe's search lag is not modelled, because the port must
 * not rely on search alone for the Customer it already knows (the membership row's), and that is
 * asserted separately below.
 */
const fakeStripe = (customers: FakeCustomer[], opts: { searchFails?: boolean } = {}) => {
  const byId = new Map(customers.map((c) => [c.id, structuredClone(c)]));
  const queries: string[] = [];
  const updates: [string, Record<string, string>][] = [];
  const api: CustomerTagApi = {
    searchCustomers: (query) => {
      queries.push(query);
      if (opts.searchFails) return Promise.reject(new Error('stripe search down'));
      const m = /metadata\['profile_id'\]:'([^']+)'/.exec(query);
      return Promise.resolve(
        [...byId.values()]
          .filter((c) => !c.deleted && c.metadata?.profile_id === m?.[1])
          .map((c) => c.id),
      );
    },
    retrieveCustomer: (id) => {
      const c = byId.get(id);
      if (!c)
        return Promise.reject(
          Object.assign(new Error('No such customer'), { code: 'resource_missing' }),
        );
      return Promise.resolve(structuredClone(c));
    },
    clearProfileTag: (id) => {
      const c = byId.get(id)!;
      // Stripe unsets a metadata key posted with an empty value.
      const { profile_id: _gone, ...rest } = c.metadata ?? {};
      c.metadata = rest;
      updates.push([id, { profile_id: '' }]);
      return Promise.resolve();
    },
  };
  return { api, byId, queries, updates };
};

Deno.test(
  'clears the tag on the membership Customer and on every tagged one search finds',
  async () => {
    const s = fakeStripe([
      { id: 'cus_member', metadata: { profile_id: PROFILE_ID, source: 'circle' } },
      { id: 'cus_abandoned', metadata: { profile_id: PROFILE_ID } },
      { id: 'cus_someone_else', metadata: { profile_id: OTHER_ID } },
    ]);
    const cleared = await customerUntagger(s.api)(PROFILE_ID, 'cus_member');
    assertEquals(cleared, 2);
    assertEquals(s.byId.get('cus_member')!.metadata, { source: 'circle' });
    assertEquals(s.byId.get('cus_abandoned')!.metadata, {});
    assertEquals(s.byId.get('cus_someone_else')!.metadata, { profile_id: OTHER_ID });
    assertEquals(s.queries, [`metadata['profile_id']:'${PROFILE_ID}'`]);
  },
);

Deno.test('the membership Customer is untagged even when search has not indexed it', async () => {
  // Search lags writes by up to a minute (docs.stripe.com/search). The Customer the membership
  // row names is the one that matters most, so it is reached by id, not through search.
  const s = fakeStripe([{ id: 'cus_member', metadata: { profile_id: PROFILE_ID } }]);
  s.api.searchCustomers = () => Promise.resolve([]);
  assertEquals(await customerUntagger(s.api)(PROFILE_ID, 'cus_member'), 1);
  assertEquals(s.byId.get('cus_member')!.metadata, {});
});

Deno.test(
  'a Customer tagged with someone else is never written, even when the row names it',
  async () => {
    const s = fakeStripe([{ id: 'cus_member', metadata: { profile_id: OTHER_ID } }]);
    assertEquals(await customerUntagger(s.api)(PROFILE_ID, 'cus_member'), 0);
    assertEquals(s.updates, []);
  },
);

Deno.test('a re-driven pass writes nothing the second time', async () => {
  // #717: a torn-down pass is re-driven, so every step must be safe to repeat.
  const s = fakeStripe([{ id: 'cus_member', metadata: { profile_id: PROFILE_ID } }]);
  const untag = customerUntagger(s.api);
  assertEquals(await untag(PROFILE_ID, 'cus_member'), 1);
  assertEquals(await untag(PROFILE_ID, 'cus_member'), 0);
  assertEquals(s.updates.length, 1);
});

Deno.test('a deleted Customer is skipped, not written', async () => {
  const s = fakeStripe([{ id: 'cus_member', deleted: true }]);
  assertEquals(await customerUntagger(s.api)(PROFILE_ID, 'cus_member'), 0);
  assertEquals(s.updates, []);
});

Deno.test('no known Customer: search alone decides', async () => {
  const s = fakeStripe([{ id: 'cus_abandoned', metadata: { profile_id: PROFILE_ID } }]);
  assertEquals(await customerUntagger(s.api)(PROFILE_ID, null), 1);
});

Deno.test(
  'a failing search rejects — the loop must hear it, not read it as «nothing tagged»',
  async () => {
    const s = fakeStripe([], { searchFails: true });
    await assertRejects(
      () => customerUntagger(s.api)(PROFILE_ID, null),
      Error,
      'stripe search down',
    );
  },
);

Deno.test('a profile id that is not a uuid is refused before any query is built', async () => {
  const s = fakeStripe([]);
  await assertRejects(() => customerUntagger(s.api)("x' OR metadata['a']:'b", null));
  assertEquals(s.queries, []);
});

Deno.test(
  'a membership Customer this key cannot see is nothing to untag, not a failure',
  async () => {
    // resource_missing / livemode_mismatch: per docs.stripe.com/error-codes the id names nothing
    // this key can reach, so there is no tag on it for a lookup made with this key to find.
    const s = fakeStripe([]);
    assertEquals(await customerUntagger(s.api)(PROFILE_ID, 'cus_other_mode'), 0);
  },
);

Deno.test('any other retrieve failure rejects', async () => {
  const s = fakeStripe([{ id: 'cus_member', metadata: { profile_id: PROFILE_ID } }]);
  s.api.retrieveCustomer = () => Promise.reject(new Error('rate limited'));
  await assertRejects(
    () => customerUntagger(s.api)(PROFILE_ID, 'cus_member'),
    Error,
    'rate limited',
  );
});
