import {
  cryptoProvider,
  stripeClient,
  verifyWithAnySecret,
  webhookSigningSecrets,
} from '../_shared/stripe.ts';
import { supabaseAdmin } from '../_shared/supabaseAdmin.ts';
import { handleWebhook } from './handlers.ts';

// Thin entrypoint: env + singletons + Deno.serve. All processing (signature gate,
// 3-layer idempotency, per-event handlers) lives in ./handlers.ts, which takes these
// as injected dependencies so `deno test` can exercise it without env or a server.
const whsec = webhookSigningSecrets(); // both endpoint scopes — see below
const qrSecret = Deno.env.get('QR_SIGNING_SECRET')!;
const db = supabaseAdmin(); // service role — the ONLY writer of money tables

// Resolved here, not at first use — the one consumer of _shared/stripe.ts that keeps the old
// import-time construction after #541, deliberately. This function's posture is `webhook`: it
// has no service-role gate for an env read to run ahead of, and it already reads its secrets
// and builds a service-role client at module scope. What makes eager resolution worth keeping
// is the failure mode: handleWebhook wraps verifyEvent in a catch that answers 400 «bad
// signature» for ANY throw and logs nothing, so an unset STRIPE_SECRET_KEY would present as a
// signature problem — for the three days Stripe keeps retrying a non-2xx. Failing at boot
// instead makes that misdiagnosis impossible. (Signature verification itself uses the signing
// secrets, not the secret key; the client is only the vehicle.)
const stripe = stripeClient();
const stripeCrypto = cryptoProvider();

// The signing secrets are NOT boot-fatal, unlike the secret key above — a missing one costs only
// its own scope's events, and throwing here would 500 every delivery on a project that lacks it,
// which is the endpoint-disabling P0 handlers.ts describes. But «its own scope goes quiet» is
// precisely how #702 hid for months, so each absence is said out loud once per cold start. Names
// only: no secret value, no payload, and nothing per-request (handleWebhook logs nothing by
// design — the reader of a 400 is Stripe, not an operator).
if (!whsec.platform) {
  console.warn(
    'STRIPE_WEBHOOK_SECRET is unset — every «Your account» event (Checkout, Billing, Identity, ' +
      'transfers) will fail signature verification and 400. RELEASE-RUNBOOK §4.2.',
  );
}
if (!whsec.connect) {
  console.warn(
    'STRIPE_CONNECT_WEBHOOK_SECRET is unset — connected-account events (account.updated / W13, ' +
      'which maintains payout_accounts) will fail signature verification and 400. Needs a second ' +
      'Dashboard endpoint scoped «Connected accounts». RELEASE-RUNBOOK §4.2.',
  );
}

Deno.serve((req) =>
  handleWebhook(
    {
      db,
      qrSecret,
      // One seam, two secrets: verifyWithAnySecret tries each configured one and rethrows the
      // first failure, so handleWebhook still sees exactly one call that either resolves an
      // event or throws. The SDK call stays here — config-invariants.test.ts requires a
      // constructEvent* in this function's own source to prove the webhook posture has a gate.
      verifyEvent: (raw, sig) =>
        verifyWithAnySecret(
          (secret) =>
            stripe.webhooks.constructEventAsync(raw, sig, secret, undefined, stripeCrypto),
          [whsec.platform, whsec.connect],
        ),
      retrieveSubscription: (id) => stripe.subscriptions.retrieve(id),
    },
    req,
  ),
);
