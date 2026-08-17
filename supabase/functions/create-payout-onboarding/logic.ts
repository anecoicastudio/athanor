import type Stripe from 'npm:stripe@22';
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { error, json } from '../_shared/respond.ts';
import { logStripeFailure } from '../_shared/stripe-error.ts';

// Onboarding construction extracted from index.ts so it is unit-testable (deno test):
// index.ts keeps the transport shell (OPTIONS/method guard, requireUser, version gate,
// env + singleton wiring) and injects everything here (repo convention: DI over mocks).
// Deliberately does NOT import ../_shared/stripe.ts — only type-level `npm:stripe` —
// so tests typecheck without STRIPE_SECRET_KEY in the env.

export type PayoutOnboardingCtx = {
  /** the caller's own client — payout_accounts is RLS select-own; is_identity_verified is invoker-callable */
  userClient: SupabaseClient;
  /**
   * service-role client for the payout_accounts INSERT — #245 grants clients no write path
   * on purpose (the SRW posture), so the initial row cannot ride the caller's RLS. The
   * capability flags stay the webhook's job; this function only ever writes the pointer row.
   */
  admin: SupabaseClient;
  /** stripe.accounts.create — Connect Express via controller properties (ruling #244) */
  createAccount: (params: Stripe.AccountCreateParams) => Promise<Stripe.Account>;
  /** stripe.accountLinks.create — single-use hosted onboarding URL */
  createAccountLink: (params: Stripe.AccountLinkCreateParams) => Promise<Stripe.AccountLink>;
  /** stripe.accounts.del — best-effort cleanup of a race-loser account (no KYC on it yet) */
  deleteAccount: (id: string) => Promise<unknown>;
  /**
   * Account Links accept only HTTP(S) URLs — live mode HTTPS only — so the athanor:// deep
   * links Checkout and Identity use are rejected here. Both come from env
   * (PAYOUT_ONBOARDING_RETURN_URL / PAYOUT_ONBOARDING_REFRESH_URL); undefined when unset.
   */
  urls: { returnUrl?: string; refreshUrl?: string };
};

export type PayoutOnboardingInput = {
  /** the verified caller (requireUser) — NEVER trusted from the body */
  profileId: string;
  /** the caller's auth email, prefilled onto the new Express account */
  email?: string;
};

/**
 * Pure params builder. Controller properties are the current spelling of "Express"
 * (deprecated `type: 'express'` shorthand avoided): Express dashboard, platform pays fees and
 * absorbs losses — the crowdfunding shape ruling #244 fixed (separate charges and transfers,
 * funds resting in Athanor's balance). Only `transfers` is requested: the winner receives,
 * never charges, and requesting card_payments would lengthen Stripe's KYC for nothing.
 * metadata.profile_id maps account.updated events back to the profile and must come from
 * getUser(), never the request body (rule #8).
 */
export function buildPayoutAccountParams(
  profileId: string,
  email?: string,
): Stripe.AccountCreateParams {
  return {
    controller: {
      stripe_dashboard: { type: 'express' },
      fees: { payer: 'application' },
      losses: { payments: 'application' },
    },
    capabilities: { transfers: { requested: true } },
    metadata: { profile_id: profileId },
    email,
  };
}

/**
 * Pure params builder. `eventually_due` = up-front collection: the payout is one transfer at
 * cycle end, so all requirements are collected in a single pass rather than surfacing new
 * ones mid-cycle when no UI exists to send the winner back through onboarding.
 */
export function buildPayoutLinkParams(
  accountId: string,
  returnUrl: string,
  refreshUrl: string,
): Stripe.AccountLinkCreateParams {
  return {
    account: accountId,
    return_url: returnUrl,
    refresh_url: refreshUrl,
    type: 'account_onboarding',
    collection_options: { fields: 'eventually_due' },
  };
}

/**
 * Creates or reuses the caller's Connect Express account and returns a fresh Account Link
 * URL — links are single-use and expire in minutes, so every call mints a new one. Identity
 * gate first (verified identity on both sides of every economic transaction), deliberately
 * NOT winner-gated: onboarding moves no money, the winner gate binds at #247's transfer path.
 * The capability flags (charges_enabled/payouts_enabled/onboarded_at) are written by the
 * stripe-webhook account.updated arm, never here (rule #6 — account state is a cache of
 * Stripe webhooks). Returns only the hosted URL; no Stripe object reaches the client.
 */
export async function createPayoutOnboarding(
  ctx: PayoutOnboardingCtx,
  input: PayoutOnboardingInput,
): Promise<Response> {
  const { userClient, admin, createAccount, createAccountLink, deleteAccount, urls } = ctx;
  const { profileId, email } = input;

  // Deploy-deferred config (the STRIPE_PRICE_* pattern): fail loud until the env is set.
  if (!urls.returnUrl || !urls.refreshUrl) return error('payout onboarding not configured', 500);

  // Identity gate — is_identity_verified is the DEFINER helper from m7_candidacy; fail-closed
  // on lookup error, never onboard an unverifiable caller.
  const { data: verified, error: verErr } = await userClient.rpc('is_identity_verified', {
    uid: profileId,
  });
  if (verErr) return error('verification lookup failed', 500);
  if (!verified) return error('identity not verified', 403);

  // Reuse the existing Express account if a row exists (RLS select-own); else create one.
  const { data: existing, error: selErr } = await userClient
    .from('payout_accounts')
    .select('stripe_account_id')
    .eq('profile_id', profileId)
    .maybeSingle();
  if (selErr) return error('payout account lookup failed', 500);

  let accountId = (existing as { stripe_account_id?: string } | null)?.stripe_account_id ?? null;

  if (!accountId) {
    let account: Stripe.Account;
    try {
      account = await createAccount(buildPayoutAccountParams(profileId, email));
    } catch (e) {
      // Bound, not bare (#416): the response stays exactly as generic as it was, but the Stripe
      // reason now reaches the function logs instead of vanishing.
      logStripeFailure('create-payout-onboarding: accounts.create', e);
      return error('could not start payout onboarding', 500);
    }

    const { error: insErr } = await admin
      .from('payout_accounts')
      .insert({ profile_id: profileId, stripe_account_id: account.id });
    if (insErr) {
      // Either way the account just created has no row pointing at it: delete it best-effort
      // (no KYC has touched it) so a retry does not leave a trail of orphans in Stripe.
      try {
        await deleteAccount(account.id);
      } catch {
        // an undeleted empty account is inert — never let cleanup mask the real outcome
      }
      // 23505 = the UNIQUE(profile_id) backstop: a concurrent call won the race between our
      // read and our insert. Honest handling: the winner's row is the truth — re-read it and
      // mint the link for THAT account. Any other insert failure is a plain 500 (retryable;
      // the create path re-runs from a clean slate).
      if ((insErr as { code?: string }).code !== '23505') {
        return error('could not save payout account', 500);
      }
      const { data: winner, error: reErr } = await admin
        .from('payout_accounts')
        .select('stripe_account_id')
        .eq('profile_id', profileId)
        .maybeSingle();
      const winnerId = (winner as { stripe_account_id?: string } | null)?.stripe_account_id;
      if (reErr || !winnerId) return error('payout account lookup failed', 500);
      accountId = winnerId;
    } else {
      accountId = account.id;
    }
  }

  try {
    const link = await createAccountLink(
      buildPayoutLinkParams(accountId, urls.returnUrl, urls.refreshUrl),
    );
    if (!link.url) return error('could not start payout onboarding', 500);
    return json({ url: link.url });
  } catch (e) {
    // Bound, not bare (#416): the response stays exactly as generic as it was, but the Stripe
    // reason now reaches the function logs instead of vanishing.
    logStripeFailure('create-payout-onboarding: accountLinks.create', e);
    return error('could not start payout onboarding', 500);
  }
}
