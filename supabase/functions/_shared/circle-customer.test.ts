// Run via `cd supabase/functions && deno test --allow-env --allow-read .` (CI edge job).
//
// Which Stripe Customers are the caller's Circle Customers when no membership row names one yet
// (#759). Two callers — create-circle-checkout guards and sweeps every one of them before it
// mints, create-circle-portal opens the portal on one before the first webhook lands — so a
// per-directory run of either misses a signature break in the other.
import { assertEquals } from 'jsr:@std/assert@1';
import type Stripe from 'npm:stripe@22';
import { circleCustomerTagQuery, taggedCircleCustomers } from './circle-customer.ts';

const PROFILE = '6f1c2d3e-4a5b-4c6d-8e7f-9a0b1c2d3e4f';

const customer = (id: string, created: number, profileId?: string): Stripe.Customer =>
  ({
    id,
    object: 'customer',
    created,
    metadata: profileId ? { profile_id: profileId } : {},
  }) as unknown as Stripe.Customer;

Deno.test('taggedCircleCustomers: only the Customers tagged with the caller, newest first', () => {
  const byEmail = [customer('cus_b', 200, PROFILE), customer('cus_else', 300, 'prof-other')];
  const byTag = [customer('cus_a', 100, PROFILE), customer('cus_c', 400, PROFILE)];
  assertEquals(
    taggedCircleCustomers([byEmail, byTag], PROFILE).map((c) => c.id),
    ['cus_c', 'cus_b', 'cus_a'],
  );
});

Deno.test('taggedCircleCustomers: a Customer both listings return is counted once', () => {
  const same = customer('cus_a', 100, PROFILE);
  assertEquals(
    taggedCircleCustomers([[same], [same]], PROFILE).map((c) => c.id),
    ['cus_a'],
  );
});

Deno.test('taggedCircleCustomers: same second → a fixed order both racers agree on', () => {
  const x = customer('cus_x', 100, PROFILE);
  const y = customer('cus_y', 100, PROFILE);
  assertEquals(
    taggedCircleCustomers([[x, y]], PROFILE).map((c) => c.id),
    ['cus_y', 'cus_x'],
  );
  assertEquals(
    taggedCircleCustomers([[y, x]], PROFILE).map((c) => c.id),
    ['cus_y', 'cus_x'],
  );
});

Deno.test('taggedCircleCustomers: an email match alone is never enough', () => {
  // The same address can belong to a Customer someone else created: an account erased and
  // re-registered under the same email gets a new profile id, and a Customer made outside this
  // code carries no tag at all. Only the server-written profile_id says whose it is.
  const untagged = customer('cus_untagged', 100);
  const old = customer('cus_old', 100, 'prof-0');
  assertEquals(taggedCircleCustomers([[untagged, old]], PROFILE), []);
  assertEquals(taggedCircleCustomers([[], []], PROFILE), []);
});

Deno.test('circleCustomerTagQuery: the metadata search for a profile id', () => {
  assertEquals(circleCustomerTagQuery(PROFILE), `metadata['profile_id']:'${PROFILE}'`);
});

Deno.test('circleCustomerTagQuery: anything but a uuid is never spliced into a query', () => {
  // profile_id comes from getUser(), so this is belt and braces — but a quote in it would end
  // the search string and let the rest rewrite the query.
  for (const bad of ["x' OR email:'a@b.c", 'prof-1', '', `${PROFILE}'`]) {
    assertEquals(circleCustomerTagQuery(bad), null, bad);
  }
});
