import { cryptoProvider, stripeClient } from '../_shared/stripe.ts';
import { supabaseAdmin } from '../_shared/supabaseAdmin.ts';
import { handleWebhook } from './handlers.ts';

// Thin entrypoint: env + singletons + Deno.serve. All processing (signature gate,
// 3-layer idempotency, per-event handlers) lives in ./handlers.ts, which takes these
// as injected dependencies so `deno test` can exercise it without env or a server.
const whsec = Deno.env.get('STRIPE_WEBHOOK_SECRET')!;
const qrSecret = Deno.env.get('QR_SIGNING_SECRET')!;
const db = supabaseAdmin(); // service role — the ONLY writer of money tables

// Resolved here, not at first use — the one consumer of _shared/stripe.ts that keeps the old
// import-time construction after #541, deliberately. This function's posture is `webhook`: it
// has no service-role gate for an env read to run ahead of, and it already reads two secrets
// and builds a service-role client at module scope. What makes eager resolution worth keeping
// is the failure mode: handleWebhook wraps verifyEvent in a catch that answers 400 «bad
// signature» for ANY throw and logs nothing, so an unset STRIPE_SECRET_KEY would present as a
// signature problem — for the three days Stripe keeps retrying a non-2xx. Failing at boot
// instead makes that misdiagnosis impossible. (Signature verification itself uses `whsec`, not
// the secret key; the client is only the vehicle.)
const stripe = stripeClient();
const stripeCrypto = cryptoProvider();

Deno.serve((req) =>
  handleWebhook(
    {
      db,
      qrSecret,
      verifyEvent: (raw, sig) =>
        stripe.webhooks.constructEventAsync(raw, sig, whsec, undefined, stripeCrypto),
      retrieveSubscription: (id) => stripe.subscriptions.retrieve(id),
    },
    req,
  ),
);
