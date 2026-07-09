import { cryptoProvider, stripe } from '../_shared/stripe.ts';
import { supabaseAdmin } from '../_shared/supabaseAdmin.ts';
import { handleWebhook } from './handlers.ts';

// Thin entrypoint: env + singletons + Deno.serve. All processing (signature gate,
// 3-layer idempotency, per-event handlers) lives in ./handlers.ts, which takes these
// as injected dependencies so `deno test` can exercise it without env or a server.
const whsec = Deno.env.get('STRIPE_WEBHOOK_SECRET')!;
const qrSecret = Deno.env.get('QR_SIGNING_SECRET')!;
const db = supabaseAdmin(); // service role — the ONLY writer of money tables

Deno.serve((req) =>
  handleWebhook(
    {
      db,
      qrSecret,
      verifyEvent: (raw, sig) =>
        stripe.webhooks.constructEventAsync(raw, sig, whsec, undefined, cryptoProvider),
      retrieveSubscription: (id) => stripe.subscriptions.retrieve(id),
    },
    req,
  ),
);
