// deno test supabase/functions/stripe-webhook/ — runs in CI (edge job) and locally.
//
// SPEC-FIRST round-trip tests across the two halves of every money flow.
//
// docs/PRD.md:382-388 describes ONE pipeline: an edge function mints the Checkout/Billing
// session, Stripe hands it back to stripe-webhook, and the webhook routes it by its metadata.
// Today each half is tested against a hand-written literal — create-ticket-checkout asserts it
// emits `{kind, event_id, profile_id}` (create-ticket-checkout/logic.test.ts:154) and
// handlers.test.ts asserts it reads a literal of the same shape (handlers.test.ts:43). Nothing
// binds them. Rename a key on the producer side and both suites stay green while every real
// payment lands as money-received-nothing-delivered.
//
// These tests feed the PRODUCER's actual output into the CONSUMER.
import { assert, assertEquals } from 'jsr:@std/assert@1';
// stripe pinned to major 22, matching the sibling suites.
import type Stripe from 'npm:stripe@22';
import { makeFakeDb, type FakeDb } from './fake-db.ts';
import { signQrToken } from './qr.ts';
import { buildTicketSessionParams } from '../create-ticket-checkout/logic.ts';
import {
  createContributionSession,
  type ContributionSessionCtx,
} from '../create-contribution-session/logic.ts';
import { createCircleCheckout, type CircleCheckoutCtx } from '../create-circle-checkout/logic.ts';
import { buildVerificationSessionParams } from '../create-verification-session/logic.ts';
import { releaseFundPayout, type ReleaseFundPayoutCtx } from '../release-fund-payout/logic.ts';
import {
  type Db,
  handleContribution,
  handleIdentityVerified,
  handleSubscription,
  handleTicketPaid,
  handleTransferCreated,
  processEvent,
} from '../stripe-webhook/handlers.ts';

const SECRET = 'test-qr-secret';
const APP = 'athanor://';
const PROFILE = 'prof-9';
const asDb = (f: FakeDb) => f as unknown as Db;

const CREATED = 1751000000;

/** Wraps producer metadata in the envelope Stripe returns on checkout.session.completed. */
const sessionFrom = (metadata: unknown, over: Record<string, unknown> = {}) =>
  ({
    id: 'cs_roundtrip',
    created: CREATED,
    currency: 'eur',
    payment_status: 'paid',
    payment_intent: 'pi_roundtrip',
    metadata,
    ...over,
  }) as unknown as Stripe.Checkout.Session;

// ── W1 ticket: docs/PRD.md:385 "checkout.completed(ticket) → event_tickets + QR" ──

Deno.test(
  'ticket metadata minted by create-ticket-checkout is readable by the webhook',
  async () => {
    const params = buildTicketSessionParams(
      { id: 'evt-9', title: 'Rito', price_cents: 700, currency: 'eur' },
      PROFILE,
      APP,
      CREATED * 1000, // injected clock (ms) — only expires_at derives from it here
    );
    const db = makeFakeDb({ 'event_tickets.upsert': [{ count: 1 }] });
    // If the producer ever renames a metadata key, handleTicketPaid throws 'missing metadata'
    // (handlers.test.ts:89) and this line fails — which is the whole point of the test.
    await handleTicketPaid(asDb(db), SECRET, sessionFrom(params.metadata));

    const values = db.calls[0].values as Record<string, unknown>;
    // The QR is signed over the ids the producer put in metadata: proving the token matches
    // proves both keys survived the round trip (docs/PRD.md:385 "+ QR").
    assertEquals(
      values.qr_token,
      await signQrToken({ eid: 'evt-9', uid: PROFILE, iat: CREATED }, SECRET),
      'the QR must be signed over the ids create-ticket-checkout put in metadata',
    );
  },
);

// ── W3 fund: docs/PRD.md:386 "checkout.completed(fund) → fund_contributions + edition totals" ──

Deno.test(
  'fund metadata minted by create-contribution-session is readable by the webhook',
  async () => {
    const producerDb = makeFakeDb({
      // phase must be an open one (D34 window gate, #222) or the producer refuses.
      'fund_editions.select': [
        { data: { id: 'ed-9', contributions_enabled: true, phase: 'voting' } },
      ],
    });
    const created: Stripe.Checkout.SessionCreateParams[] = [];
    const producerCtx: ContributionSessionCtx = {
      userClient: producerDb as unknown as ContributionSessionCtx['userClient'],
      createCheckoutSession: (p) => {
        created.push(p);
        return Promise.resolve({
          url: 'https://checkout.stripe.test/cs_1',
        } as Stripe.Checkout.Session);
      },
      appBase: APP,
    };
    await createContributionSession(producerCtx, {
      profileId: PROFILE,
      editionId: 'ed-9',
      amountCents: 2500,
    });
    assertEquals(created.length, 1, 'producer must have minted a session');

    const db = makeFakeDb({ 'fund_contributions.upsert': [{ count: 1 }] });
    await handleContribution(asDb(db), sessionFrom(created[0].metadata, { amount_total: 2500 }));

    // The edition id must survive end to end, or the public ticker recomputes the wrong edition
    // (or none) while the money is already in (docs/PRD.md:386, docs/PRD.md:209).
    const rpc = db.calls.find((c) => c.op === 'rpc');
    assert(rpc, 'the fund branch must recompute the edition aggregate');
    assertEquals(rpc.values, { p_edition_id: 'ed-9' });
  },
);

// ── W5/W11 circle: docs/PRD.md:387 "subscription.* → circle_memberships cache" ──

Deno.test(
  'circle metadata minted by create-circle-checkout is readable by both webhook paths',
  async () => {
    const producerDb = makeFakeDb({
      'circle_memberships.select': [{ data: { stripe_customer_id: 'cus_1' } }],
    });
    const sessions: Stripe.Checkout.SessionCreateParams[] = [];
    const producerCtx: CircleCheckoutCtx = {
      userClient: producerDb as unknown as CircleCheckoutCtx['userClient'],
      createCustomer: () => Promise.resolve({ id: 'cus_new' } as Stripe.Customer),
      createCheckoutSession: (p) => {
        sessions.push(p);
        return Promise.resolve({
          url: 'https://checkout.stripe.test/cs_1',
        } as Stripe.Checkout.Session);
      },
      // A live monthly Price: the gate (#674 item 7) runs before the session is built.
      retrievePrice: () =>
        Promise.resolve({
          active: true,
          currency: 'eur',
          unit_amount: 1200,
          recurring: { interval: 'month', interval_count: 1 },
        } as unknown as Stripe.Price),
      priceIds: { monthly: 'price_month_1', annual: 'price_year_1' },
      appBase: APP,
    };
    await createCircleCheckout(producerCtx, {
      profileId: PROFILE,
      email: 'seeker@example.com',
      plan: 'monthly',
    });
    const params = sessions[0];

    // Path A (W11): the checkout session's own metadata must route to the subscription reconcile.
    const dbA = makeFakeDb();
    const retrieved: string[] = [];
    await processEvent(
      {
        db: asDb(dbA),
        qrSecret: SECRET,
        retrieveSubscription: (id: string) => {
          retrieved.push(id);
          return Promise.resolve({
            id: 'sub_1',
            status: 'active',
            customer: 'cus_1',
            metadata: params.subscription_data?.metadata,
            items: { data: [{ price: { recurring: { interval: 'month' } } }] },
            current_period_end: 1760000000,
          } as unknown as Stripe.Subscription);
        },
      },
      {
        id: 'evt_rt',
        type: 'checkout.session.completed',
        data: { object: sessionFrom(params.metadata, { subscription: 'sub_1' }) },
      } as unknown as Stripe.Event,
    );
    assertEquals(retrieved, ['sub_1'], 'kind=subscription must trigger the W11 reconcile');
    assertEquals(dbA.calls[0].table, 'circle_memberships');

    // Path B (W5/W6/W7): subscription_data.metadata rides the Subscription object itself and is
    // the ONLY carrier of profile_id on renewals — handleSubscription throws without it
    // (handlers.test.ts:323).
    const dbB = makeFakeDb();
    await handleSubscription(asDb(dbB), {
      id: 'sub_1',
      status: 'active',
      customer: 'cus_1',
      metadata: params.subscription_data?.metadata,
      items: {
        data: [{ price: { recurring: { interval: 'month' } }, current_period_end: 1760000000 }],
      },
    } as unknown as Stripe.Subscription);
    const values = dbB.calls[0].values as Record<string, unknown>;
    assertEquals(values.profile_id, PROFILE, 'the membership must be cached against the payer');
  },
);

// ── W9 identity: docs/PRD.md:388 "identity.verified → verifications → badge + score event" ──

Deno.test(
  'identity metadata minted by create-verification-session is readable by the webhook',
  async () => {
    const params = buildVerificationSessionParams(PROFILE, APP);
    const db = makeFakeDb();
    await handleIdentityVerified(asDb(db), {
      id: 'vs_1',
      metadata: params.metadata,
    } as unknown as Stripe.Identity.VerificationSession);

    // docs/PRD.md:225 — verification grants the verified badge. If the metadata key drifts, the
    // person pays for and completes an Identity check that silently badges nobody.
    const profileUpdate = db.calls.find((c) => c.table === 'profiles');
    assert(profileUpdate, 'the verified badge must be applied to a profile');
    assertEquals(profileUpdate.filters, [['eq', 'id', PROFILE]]);
  },
);

// ── W14 fund payout: release-fund-payout mints → the webhook records (#247) ──

Deno.test(
  'fund payout metadata minted by release-fund-payout is readable by the webhook',
  async () => {
    // The same producer→consumer wire as the checkouts above, on the money-OUT side: the
    // release path sets the declared-retention basis on the transfer, and the webhook arm
    // rebuilds the ledger row from it. A drifted key would move real money and record
    // nothing — reconciliation would go blind while both halves' own suites stay green.
    const ED = '00000000-0000-0000-0000-0000000000ed';
    const PHASE = '22222222-2222-2222-2222-222222222222';
    const producer = makeFakeDb({
      'fund_editions.select': [
        {
          data: {
            phase: 'announcement',
            closure_reason: null,
            winner_candidacy_id: '00000000-0000-0000-0000-00000000000c',
            winner_confirmed_at: '2026-08-15T12:00:00.000Z',
            confirmed_pool_cents: 10000,
            split_pct: 10,
          },
        },
      ],
      // #231: a verified phase of a published plan — without it the release refuses and
      // this wire never carries anything.
      'realization_plan_phases.select': [
        {
          data: {
            amount_cents: 9000,
            verified_at: '2026-08-16T09:00:00.000Z',
            realization_plans: { edition_id: ED, published_at: '2026-08-16T08:00:00.000Z' },
          },
        },
      ],
      'dream_candidacies.select': [{ data: { profile_id: PROFILE } }],
      'payout_accounts.select': [
        { data: { stripe_account_id: 'acct_win', charges_enabled: true, payouts_enabled: true } },
      ],
    });
    let minted: Stripe.TransferCreateParams | null = null;
    const res = await releaseFundPayout(
      {
        admin: producer as unknown as ReleaseFundPayoutCtx['admin'],
        createTransfer: (params) => {
          minted = params;
          return Promise.resolve({ id: 'tr_rt' } as Stripe.Transfer);
        },
        listTransfers: () => Promise.resolve([]),
        retrieveBalance: () =>
          Promise.resolve({
            available: [{ currency: 'eur', amount: 100000 }],
            pending: [],
          } as unknown as Stripe.Balance),
      },
      new Request('http://localhost/release-fund-payout', {
        method: 'POST',
        body: JSON.stringify({ editionId: ED, planPhaseId: PHASE, amountCents: 4000 }),
      }),
    );
    assertEquals(res.status, 200);
    assert(minted, 'the release must mint a transfer');

    const consumer = makeFakeDb();
    await handleTransferCreated(asDb(consumer), {
      id: 'tr_rt',
      amount: (minted as Stripe.TransferCreateParams).amount,
      amount_reversed: 0,
      currency: (minted as Stripe.TransferCreateParams).currency,
      destination: (minted as Stripe.TransferCreateParams).destination,
      metadata: (minted as Stripe.TransferCreateParams).metadata,
    } as unknown as Stripe.Transfer);

    assertEquals(consumer.calls.length, 1, 'the webhook must record exactly one ledger row');
    const values = consumer.calls[0].values as Record<string, unknown>;
    assertEquals(consumer.calls[0].table, 'fund_payout_ledger');
    assertEquals(values.edition_id, ED);
    assertEquals(values.amount_cents, 4000);
    assertEquals(values.pool_cents, 10000);
    assertEquals(values.split_pct, 10);
    assertEquals(values.payable_cents, 9000);
    assertEquals(values.destination_account_id, 'acct_win');
    // #231's key on the same wire: the attribution the gate produced must survive to the
    // ledger, or the released tranche reconciles to the cycle but to no phase of the plan.
    assertEquals(values.plan_phase_id, PHASE);
  },
);
