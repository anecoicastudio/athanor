// release-fund-payout (#247) — internal service-role: the transfer-executing path of the
// payout rail (ruling #244: separate charges and transfers, funds resting in Athanor's
// balance; hold-from-settlement — settled funds only, capped at settled-minus-released).
// #248's pg_cron sweep and the operator call it with a secret key on the `apikey` header.
// It REQUESTS one Stripe transfer toward the cycle winner's connected account and writes
// no row — the stripe-webhook transfer.created arm records fund_payout_ledger (rule #6).
// Transport shell only — the refusal ladder, caps and Stripe params live in ./logic.ts
// (unit-tested, DI'd).
import { requireServiceRole } from '../_shared/auth.ts';
import { supabaseAdmin } from '../_shared/supabaseAdmin.ts';
import { stripe } from '../_shared/stripe.ts';
import { releaseFundPayout } from './logic.ts';

Deno.serve((req) => {
  // Caller gate: service-role only, first statement (see _shared/auth.ts).
  const gate = requireServiceRole(req);
  if (!gate.ok) return gate.response;

  return releaseFundPayout(
    {
      admin: supabaseAdmin(),
      createTransfer: (params, opts) => stripe.transfers.create(params, opts),
      listTransfers: async (transferGroup) => {
        // Auto-paginate: the cap must see EVERY transfer in the group, not the first page.
        const out = [];
        for await (const t of stripe.transfers.list({
          transfer_group: transferGroup,
          limit: 100,
        })) {
          out.push(t);
        }
        return out;
      },
      retrieveBalance: () => stripe.balance.retrieve(),
    },
    req,
  );
});
