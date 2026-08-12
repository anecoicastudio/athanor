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
import {
  type Db,
  handleContribution,
  handleIdentityVerified,
  handleSubscription,
  handleTicketPaid,
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
      'fund_editions.select': [{ data: { id: 'ed-9', contributions_enabled: true } }],
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
