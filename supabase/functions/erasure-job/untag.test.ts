// deno test supabase/functions/erasure-job/ — runs in CI (edge job) and locally.
//
// The transport half of erasure step (3b-ter), #763: clearing `metadata.profile_id` off the
// membership row's Stripe Customer. ./logic.test.ts mocks the port and pins what the LOOP does
// with an untag outcome; this file pins how the port treats the Customer, against a fake of the
// two SDK calls it uses. index.ts is a `Deno.serve` shell no test executes (#542), so the logic
// lives here where one can.
import { assertEquals, assertRejects } from 'jsr:@std/assert@1';
import { type CustomerTagApi, customerUntagger } from './untag.ts';

const PROFILE_ID = '3f1c7a52-1b0e-4a6f-9f0b-2c4d5e6f7a8b';
const OTHER_ID = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';

type FakeCustomer = { id: string; deleted?: boolean; metadata?: Record<string, string> };

/** A Stripe that holds Customers and answers retrieve / update like the real one on these points. */
const fakeStripe = (customers: FakeCustomer[]) => {
  const byId = new Map(customers.map((c) => [c.id, structuredClone(c)]));
  const updates: string[] = [];
  const api: CustomerTagApi = {
    retrieveCustomer: (id) => {
      const c = byId.get(id);
      if (!c) {
        return Promise.reject(
          Object.assign(new Error('No such customer'), { code: 'resource_missing' }),
        );
      }
      return Promise.resolve(structuredClone(c));
    },
    clearProfileTag: (id) => {
      const c = byId.get(id)!;
      // Stripe unsets a metadata key posted with an empty value.
      const { profile_id: _gone, ...rest } = c.metadata ?? {};
      c.metadata = rest;
      updates.push(id);
      return Promise.resolve();
    },
  };
  return { api, byId, updates };
};

Deno.test('clears the tag and nothing else on the Customer', async () => {
  const s = fakeStripe([
    { id: 'cus_member', metadata: { profile_id: PROFILE_ID, source: 'circle' } },
  ]);
  assertEquals(await customerUntagger(s.api)(PROFILE_ID, 'cus_member'), true);
  assertEquals(s.byId.get('cus_member')!.metadata, { source: 'circle' });
});

Deno.test('a Customer tagged with someone else is never written', async () => {
  const s = fakeStripe([{ id: 'cus_member', metadata: { profile_id: OTHER_ID } }]);
  assertEquals(await customerUntagger(s.api)(PROFILE_ID, 'cus_member'), false);
  assertEquals(s.updates, []);
});

Deno.test('a re-driven pass writes nothing the second time', async () => {
  // #717: a torn-down pass is re-driven, so every step must be safe to repeat.
  const s = fakeStripe([{ id: 'cus_member', metadata: { profile_id: PROFILE_ID } }]);
  const untag = customerUntagger(s.api);
  assertEquals(await untag(PROFILE_ID, 'cus_member'), true);
  assertEquals(await untag(PROFILE_ID, 'cus_member'), false);
  assertEquals(s.updates, ['cus_member']);
});

Deno.test('a deleted Customer is skipped, not written', async () => {
  const s = fakeStripe([{ id: 'cus_member', deleted: true }]);
  assertEquals(await customerUntagger(s.api)(PROFILE_ID, 'cus_member'), false);
  assertEquals(s.updates, []);
});

Deno.test('a Customer this key cannot see is nothing to untag, not a failure', async () => {
  // resource_missing / livemode_mismatch: per docs.stripe.com/error-codes the id names nothing
  // this key can reach, so there is no tag on it for a lookup made with this key to find.
  const s = fakeStripe([]);
  assertEquals(await customerUntagger(s.api)(PROFILE_ID, 'cus_other_mode'), false);
});

Deno.test('any other retrieve failure rejects', async () => {
  const s = fakeStripe([{ id: 'cus_member', metadata: { profile_id: PROFILE_ID } }]);
  s.api.retrieveCustomer = () => Promise.reject(new Error('rate limited'));
  await assertRejects(
    () => customerUntagger(s.api)(PROFILE_ID, 'cus_member'),
    Error,
    'rate limited',
  );
});

Deno.test('an update failure rejects', async () => {
  const s = fakeStripe([{ id: 'cus_member', metadata: { profile_id: PROFILE_ID } }]);
  s.api.clearProfileTag = () => Promise.reject(new Error('stripe 503'));
  await assertRejects(() => customerUntagger(s.api)(PROFILE_ID, 'cus_member'), Error, 'stripe 503');
});
