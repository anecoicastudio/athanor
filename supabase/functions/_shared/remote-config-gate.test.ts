// Run via `cd supabase/functions && deno test --allow-env --allow-read --no-lock .` (CI edge job).
//
// The fail-closed ladder used to live inside `create-circle-checkout/logic.ts`, where its only
// coverage was Circle's end-to-end tests. #806 gives it two more callers — `create-ticket-checkout`
// and `create-payout-onboarding` — so it is asserted here, once, on the module every rail reads it
// from. Each arm below is one way a gate could quietly fail OPEN, which on these rails means a
// hosted Checkout against keys that may still be test-mode.
import { assertEquals } from 'jsr:@std/assert@1';
import { makeFakeDb, type FakeResult } from './fake-db.ts';
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import {
  CIRCLE_CHECKOUT_FLAG,
  logFlagClosed,
  PAID_EVENTS_FLAG,
  readFlagGate,
} from './remote-config-gate.ts';

const db = (r?: FakeResult) =>
  makeFakeDb(r ? { 'remote_config.select': [r] } : {}) as unknown as SupabaseClient;

Deno.test('flag true → open, read by PK on the key it was asked for', async () => {
  const fake = makeFakeDb({ 'remote_config.select': [{ data: { value: { enabled: true } } }] });
  const gate = await readFlagGate(fake as unknown as SupabaseClient, PAID_EVENTS_FLAG);
  assertEquals(gate, { open: true });
  assertEquals(fake.calls.length, 1);
  assertEquals(fake.calls[0].table, 'remote_config');
  assertEquals(fake.calls[0].columns, 'value');
  assertEquals(fake.calls[0].filters, [['eq', 'key', PAID_EVENTS_FLAG]]);
  assertEquals(fake.calls[0].terminal, 'maybeSingle');
});

Deno.test('flag false → closed with reason off', async () => {
  assertEquals(await readFlagGate(db({ data: { value: { enabled: false } } }), PAID_EVENTS_FLAG), {
    open: false,
    reason: 'off',
  });
});

Deno.test('absent row → closed', async () => {
  // The production state before a cutover: no row at all is the closed state, by design.
  assertEquals(await readFlagGate(db({ data: null }), PAID_EVENTS_FLAG), {
    open: false,
    reason: 'absent',
  });
});

Deno.test('malformed value → closed (truthy is not true)', async () => {
  for (const value of [{ enabled: 'true' }, { enabled: 1 }, { enabled: null }, {}, null, 'on', 7]) {
    assertEquals(
      await readFlagGate(db({ data: { value } }), PAID_EVENTS_FLAG),
      { open: false, reason: 'malformed' },
      `${JSON.stringify(value)} must not open the gate`,
    );
  }
});

Deno.test('read error → closed, even when an open payload rides along', async () => {
  // The payload says open; only the error arm can close this — so a reader that ignored the error
  // would go red here rather than passing on the payload.
  const gate = await readFlagGate(
    db({
      data: { value: { enabled: true } },
      error: { message: 'connection reset', code: '08006' },
    }),
    PAID_EVENTS_FLAG,
  );
  assertEquals(gate, { open: false, reason: 'read-error' });
});

Deno.test('an unscripted read is closed, not open', async () => {
  // `makeFakeDb` resolves `{ data: null }` for anything unscripted. Pinned because it is also the
  // shape of a table that does not answer, and the direction of that default is the whole contract.
  assertEquals(await readFlagGate(db(), CIRCLE_CHECKOUT_FLAG), { open: false, reason: 'absent' });
});

Deno.test('the flag names are the seeded keys', () => {
  // The app mirrors both strings; `apps/native/src/lib/paid-events-gate.test.ts` reads this file as
  // text to pin the pair across the workspace boundary. Spelt out here so a rename is caught on
  // this side too, rather than only by the mirror.
  assertEquals(CIRCLE_CHECKOUT_FLAG, 'circle_checkout_enabled');
  assertEquals(PAID_EVENTS_FLAG, 'paid_events_enabled');
});

Deno.test('the refusal line carries configuration only, and keeps Circle’s exact shape', () => {
  const lines: string[] = [];
  logFlagClosed(
    {
      tag: 'circle',
      fn: 'create-circle-checkout',
      message: 'checkout closed',
      flag: CIRCLE_CHECKOUT_FLAG,
      reason: 'off',
    },
    (l) => lines.push(l),
  );
  // Byte-for-byte what `create-circle-checkout/logic.test.ts` has pinned since #747: moving the
  // formatter here must not change one character of what an operator greps for.
  assertEquals(lines, [
    '[circle] create-circle-checkout: checkout closed {"flag":"circle_checkout_enabled","reason":"off"}',
  ]);

  lines.length = 0;
  logFlagClosed(
    {
      tag: 'events',
      fn: 'create-ticket-checkout',
      message: 'paid events closed',
      flag: PAID_EVENTS_FLAG,
      reason: 'absent',
    },
    (l) => lines.push(l),
  );
  assertEquals(lines, [
    '[events] create-ticket-checkout: paid events closed {"flag":"paid_events_enabled","reason":"absent"}',
  ]);
});
