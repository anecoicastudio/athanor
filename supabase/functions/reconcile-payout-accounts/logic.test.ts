import { assert, assertEquals } from 'jsr:@std/assert@1';
import type Stripe from 'npm:stripe@22';
import { makeFakeDb } from '../_shared/fake-db.ts';
import type { FakeDb } from '../_shared/fake-db.ts';
import { reconcilePayoutAccounts } from './logic.ts';
import type { ReconcileCtx } from './logic.ts';

type Db = ReconcileCtx['admin'];
const asDb = (f: FakeDb) => f as unknown as Db;

const ACCT = 'acct_1UCjucPuFctf3F8i';
const OTHER = 'acct_1UCjRULodilJxQHS';

/** A Stripe account, narrowed to the three fields the cache mirrors. */
const account = (over: Partial<Stripe.Account> = {}) =>
  ({
    id: ACCT,
    charges_enabled: true,
    payouts_enabled: true,
    details_submitted: true,
    ...over,
  }) as Stripe.Account;

const post = (body?: string) =>
  new Request('https://edge.test/reconcile-payout-accounts', {
    method: 'POST',
    body: body ?? '',
  });

type Opts = {
  rows?: unknown;
  selectError?: unknown;
  retrieve?: (id: string) => Promise<Stripe.Account>;
};

function ctx(opts: Opts = {}) {
  const retrieved: string[] = [];
  const db = makeFakeDb({
    'payout_accounts.select': [{ data: opts.rows ?? [], error: opts.selectError ?? null }],
  });
  const context: ReconcileCtx = {
    admin: asDb(db),
    retrieveAccount: (id) => {
      retrieved.push(id);
      return opts.retrieve ? opts.retrieve(id) : Promise.resolve(account({ id }));
    },
  };
  return { context, db, retrieved };
}

const body = async (res: Response) => (await res.json()) as Record<string, unknown>;

Deno.test('a row Stripe disagrees with is corrected, and the report says what moved', async () => {
  const { context, db, retrieved } = ctx({
    rows: [{ stripe_account_id: ACCT, charges_enabled: false, payouts_enabled: false }],
  });

  const res = await reconcilePayoutAccounts(context, post());
  assertEquals(res.status, 200);
  const out = await body(res);
  assertEquals(out.checked, 1);
  assertEquals(out.corrected, 1);
  assertEquals(out.failed, 0);
  assertEquals(retrieved, [ACCT]);

  // The write goes through handleAccountUpdated, so it is the same shape W13 produces.
  const update = db.calls.find((c) => c.table === 'payout_accounts' && c.op === 'update');
  assert(update, 'no update issued');
  assertEquals(update.values, { charges_enabled: true, payouts_enabled: true });
  assertEquals(update.filters, [['eq', 'stripe_account_id', ACCT]]);
});

Deno.test('a row already in step is written anyway and reported unchanged', async () => {
  // Written even on flag equality: onboarded_at is stamped set-once by the same handler and can
  // be NULL on a row whose flags already match — the half-repaired shape a later event leaves.
  const { context, db } = ctx({
    rows: [{ stripe_account_id: ACCT, charges_enabled: true, payouts_enabled: true }],
  });

  const out = await body(await reconcilePayoutAccounts(context, post()));
  assertEquals(out.corrected, 0);
  assertEquals(out.checked, 1);
  assertEquals((out.outcomes as { status: string }[])[0].status, 'unchanged');
  assert(
    db.calls.some((c) => c.table === 'payout_accounts' && c.op === 'update'),
    'an unchanged row must still be written — onboarded_at is the reason',
  );
});

Deno.test('a Stripe failure on one account does not abort the rest', async () => {
  const { context, retrieved } = ctx({
    rows: [
      { stripe_account_id: ACCT, charges_enabled: false, payouts_enabled: false },
      { stripe_account_id: OTHER, charges_enabled: false, payouts_enabled: false },
    ],
    retrieve: (id) =>
      id === ACCT ? Promise.reject(new Error('stripe down')) : Promise.resolve(account({ id })),
  });

  const out = await body(await reconcilePayoutAccounts(context, post()));
  assertEquals(retrieved, [ACCT, OTHER], 'the second account must still be retrieved');
  assertEquals(out.checked, 2);
  assertEquals(out.failed, 1);
  assertEquals(out.corrected, 1);
});

Deno.test('naming one account narrows the select rather than filtering in memory', async () => {
  const { context, db } = ctx({
    rows: [{ stripe_account_id: ACCT, charges_enabled: false, payouts_enabled: false }],
  });

  await reconcilePayoutAccounts(context, post(JSON.stringify({ stripeAccountId: ACCT })));
  const select = db.calls.find((c) => c.table === 'payout_accounts' && c.op === 'select');
  assert(select, 'no select issued');
  assertEquals(select.filters, [['eq', 'stripe_account_id', ACCT]]);
});

Deno.test('an empty body is the whole sweep, not a parse error', async () => {
  const { context, db } = ctx({ rows: [] });
  const res = await reconcilePayoutAccounts(context, post());
  assertEquals(res.status, 200);
  const select = db.calls.find((c) => c.table === 'payout_accounts' && c.op === 'select');
  assertEquals(select?.filters, [], 'an unnarrowed sweep must not carry a filter');
});

Deno.test('an unknown key is a 400, never a silent full sweep', async () => {
  const { context, db } = ctx({ rows: [] });
  const res = await reconcilePayoutAccounts(context, post(JSON.stringify({ accountId: ACCT })));
  assertEquals(res.status, 400);
  assertEquals(db.calls.length, 0, 'a rejected body must not reach the database');
});

Deno.test('malformed JSON is a 400, not a crash', async () => {
  const { context } = ctx({ rows: [] });
  assertEquals((await reconcilePayoutAccounts(context, post('{nope'))).status, 400);
});

Deno.test('a select failure is a 500 and reaches Stripe zero times', async () => {
  const { context, retrieved } = ctx({ selectError: { message: 'boom' } });
  const res = await reconcilePayoutAccounts(context, post());
  assertEquals(res.status, 500);
  assertEquals(retrieved, []);
});

Deno.test('no rows is a clean zero, not an error', async () => {
  const { context } = ctx({ rows: [] });
  const out = await body(await reconcilePayoutAccounts(context, post()));
  assertEquals(out, { checked: 0, corrected: 0, failed: 0, outcomes: [] });
});

Deno.test('an unmatched stripe_account_id acks — W13 behaviour, not an error', async () => {
  // handleAccountUpdated is update-only and matched on stripe_account_id: a 0-row update is
  // correct and must not be reported as a failure. Recreating the row would resurrect a
  // hard-deleted profile's pointer.
  const { context } = ctx({
    rows: [{ stripe_account_id: ACCT, charges_enabled: true, payouts_enabled: true }],
  });
  const out = await body(await reconcilePayoutAccounts(context, post()));
  assertEquals(out.failed, 0);
});
