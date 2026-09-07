// reconcile-payout-accounts (#707) — internal service-role: compare the payout_accounts cache
// against Stripe and write back what Stripe says, through the same handler the W13
// account.updated arm uses (`_shared/payout-account-cache.ts`). Nothing schedules it; an
// operator invokes it after a webhook outage, a mis-scoped endpoint, or a report of an organiser
// stuck behind the Connect-your-account CTA. POST {} sweeps every row; POST
// {"stripeAccountId":"acct_…"} narrows to one.
//
// The cache's capability columns are otherwise written only by a delivered account.updated, and
// a delivery that never happens leaves no trace: stripe_webhook_events is silent, because
// silence is what "never delivered" looks like. See docs/RELEASE-RUNBOOK.md §4.2.
//
// Transport shell only — the comparison, the per-row failure isolation and the report shape live
// in ./logic.ts (unit-tested, DI'd).
import { requireServiceRole } from '../_shared/auth.ts';
import { supabaseAdmin } from '../_shared/supabaseAdmin.ts';
import { stripeClient } from '../_shared/stripe.ts';
import { reconcilePayoutAccounts } from './logic.ts';

Deno.serve((req) => {
  // Caller gate: service-role only, first statement (see _shared/auth.ts). A sb_secret_… key is
  // not a JWT, so verify_jwt = false and this is the ONLY gate.
  const gate = requireServiceRole(req);
  if (!gate.ok) return gate.response;

  return reconcilePayoutAccounts(
    {
      admin: supabaseAdmin(),
      retrieveAccount: (id) => stripeClient().accounts.retrieve(id),
    },
    req,
  );
});
