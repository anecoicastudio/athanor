import { z } from 'zod';
import type Stripe from 'npm:stripe@22';
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { error, json } from '../_shared/respond.ts';

// The transfer-executing path (#247, ruling #244): #248's pg_cron sweep and the operator
// call this to move a tranche of a cycle's payable to the winner's connected account.
// Design-doc pattern: separate charges and transfers — the transfer happens HERE, later,
// on a condition, never via transfer_data at charge time. Rule #6 division of labour:
// this function REQUESTS the transfer from Stripe and writes no database row; the
// stripe-webhook transfer.created arm RECORDS it in fund_payout_ledger. Everything is
// injected (repo convention: DI over mocks); deliberately does NOT import
// ../_shared/stripe.ts — only type-level `npm:stripe` — so tests typecheck without
// STRIPE_SECRET_KEY in the env. Transport shell in index.ts (requireServiceRole first).
//
// #231's "no verification, no money" gate is NOT here yet — it slots into this refusal
// ladder when that issue lands. #228/#229's plan model will schedule WHEN and HOW MUCH
// releases; until then amountCents is caller-supplied and every cap below still binds.

/** The fund pool's only currency — fund_contributions defaults 'eur' and nothing else is enabled. */
export const FUND_CURRENCY = 'eur';

/** Stripe-side grouping label for a cycle's transfers — also what releasedNet is listed by. */
export function transferGroup(editionId: string): string {
  return `fund_edition_${editionId}`;
}

/**
 * floor(pool × (100 − split) / 100) — the most a cycle's winner can ever receive under
 * the cycle's declared retention (#232's frozen columns; the rider on #247: never a
 * constant, never a figure chosen at transfer time). Mirrors the Postgres CHECK on
 * fund_payout_ledger.payable_cents (bigint division truncates ≡ floor on non-negatives).
 */
export function payableCents(poolCents: number, splitPct: number): number {
  return Math.floor((poolCents * (100 - splitPct)) / 100);
}

// #248's pg_cron sweep body — same `mode` convention as push-dispatch's receipt sweep.
const sweepPayload = z.object({ mode: z.literal('sweep') }).strict();

const payload = z
  .object({
    editionId: z.string().uuid(),
    amountCents: z.number().int().positive(),
  })
  .strict();

export type ReleaseFundPayoutCtx = {
  /** service-role client — reads fund_editions / dream_candidacies / payout_accounts */
  admin: SupabaseClient;
  /** stripe.transfers.create with an idempotency key (see the key derivation below) */
  createTransfer: (
    params: Stripe.TransferCreateParams,
    opts: { idempotencyKey: string },
  ) => Promise<Stripe.Transfer>;
  /**
   * ALL transfers Stripe holds for a transfer_group (index.ts auto-paginates). Stripe is
   * the source of truth for what was already released — the ledger is a webhook cache and
   * may lag a delivery, and ruling #244's cap ("no payout may exceed settled-minus-released
   * at any moment") must hold against the money that actually moved.
   */
  listTransfers: (transferGroup: string) => Promise<Stripe.Transfer[]>;
  /** stripe.balance.retrieve — the settled/pending split on Athanor's own balance */
  retrieveBalance: () => Promise<Stripe.Balance>;
};

type EditionRow = {
  phase: string;
  closure_reason: string | null;
  winner_candidacy_id: string | null;
  winner_confirmed_at: string | null;
  confirmed_pool_cents: number | null;
  split_pct: number;
};

/** Net released for a cycle, per Stripe: sum(amount − amount_reversed) over its group. */
export function releasedNetCents(
  transfers: Pick<Stripe.Transfer, 'amount' | 'amount_reversed'>[],
): number {
  return transfers.reduce((sum, t) => sum + t.amount - (t.amount_reversed ?? 0), 0);
}

/**
 * Refusal ladder, then one Stripe transfer. Refusals are 4xx and move no money:
 * unknown cycle, no declared/confirmed winner, wrong phase (transfers run in
 * announcement/realization, and on a 'closed'+'realized' cycle whose payable remainder
 * was already accounted as disbursed by close_cycle — a failed or voided closure carried
 * its remainder to the successor, so those refuse), unready account (#245's flags default
 * false — fail closed), would-exceed (the #244 cap against Stripe-listed released-net),
 * and unsettled (the transfer must fit inside Stripe's AVAILABLE balance — ruling #244:
 * settled funds only, never pending balances).
 *
 * Idempotency: the Stripe key embeds the released-net observed at decision time, so a
 * concurrent duplicate of the SAME release replays the original transfer instead of
 * minting a second, and a DIFFERENT amount racing the same state dies with Stripe's
 * idempotency conflict (409 here). A follow-up tranche is accepted as soon as the
 * previous transfer is visible in Stripe's own list — no webhook round-trip needed.
 */
export async function releaseFundPayout(
  ctx: ReleaseFundPayoutCtx,
  req: Request,
): Promise<Response> {
  const { admin } = ctx;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return error('invalid json', 400);
  }
  // #248's sweep entry point, deliberately inert: the enumeration source for "which
  // tranche is due" is #228/#229's realization-plan schema, which does not exist yet,
  // and #231's verification gate has not landed in the ladder below. Until both do
  // there are no due tranches BY CONSTRUCTION — the sweep must not invent an amount
  // (FUND-25: tranches release against the plan's phases, each on verification; a
  // sweep-chosen "full remaining payable" would pass the ladder and move unverified
  // money). Zero reads, zero transfers; the cron cadence still gets exercised end-to-end.
  if (sweepPayload.safeParse(body).success) {
    return json({ mode: 'sweep', dueTranches: 0, transfersRequested: 0 });
  }

  const parsed = payload.safeParse(body);
  if (!parsed.success) return error('invalid payload', 400);
  const { editionId, amountCents } = parsed.data;

  const { data: editionData, error: edErr } = await admin
    .from('fund_editions')
    .select(
      'phase,closure_reason,winner_candidacy_id,winner_confirmed_at,confirmed_pool_cents,split_pct',
    )
    .eq('id', editionId)
    .maybeSingle();
  if (edErr) return error('edition lookup failed', 500);
  if (!editionData) return error('edition not found', 404);
  const edition = editionData as EditionRow;

  if (!edition.winner_candidacy_id) return error('no winner declared', 409);
  if (!edition.winner_confirmed_at) return error('viability not confirmed', 409);
  const phaseOk =
    edition.phase === 'announcement' ||
    edition.phase === 'realization' ||
    (edition.phase === 'closed' && edition.closure_reason === 'realized');
  if (!phaseOk) {
    // A failed/voided closure carried its unreleased remainder to the successor — that
    // money is no longer this cycle's to move. Pre-announcement phases have no snapshot.
    return error(edition.phase === 'closed' ? 'cycle closed' : 'release out of phase', 409);
  }
  if (edition.confirmed_pool_cents === null) return error('no confirmed pool', 409);

  const { data: candidacy, error: candErr } = await admin
    .from('dream_candidacies')
    .select('profile_id')
    .eq('id', edition.winner_candidacy_id)
    .maybeSingle();
  if (candErr) return error('winner lookup failed', 500);
  const winnerProfileId = (candidacy as { profile_id: string | null } | null)?.profile_id ?? null;
  // An erased winner has no destination — same refusal as never having onboarded.
  if (!winnerProfileId) return error('no payout account', 409);

  const { data: accountData, error: accErr } = await admin
    .from('payout_accounts')
    .select('stripe_account_id,charges_enabled,payouts_enabled')
    .eq('profile_id', winnerProfileId)
    .maybeSingle();
  if (accErr) return error('payout account lookup failed', 500);
  if (!accountData) return error('no payout account', 409);
  const account = accountData as {
    stripe_account_id: string;
    charges_enabled: boolean;
    payouts_enabled: boolean;
  };
  // Both flags, both required, both default false until Stripe's KYC says otherwise —
  // and account.updated revokes them again when requirements lapse (W13 both directions).
  if (!account.charges_enabled || !account.payouts_enabled) {
    return error('payout account not ready', 409);
  }

  const payable = payableCents(edition.confirmed_pool_cents, edition.split_pct);
  const group = transferGroup(editionId);

  let releasedNet: number;
  try {
    releasedNet = releasedNetCents(await ctx.listTransfers(group));
  } catch {
    return error('transfer listing failed', 502);
  }
  if (amountCents > payable - releasedNet) return error('would exceed declared payable', 409);

  let availableCents: number;
  try {
    const balance = await ctx.retrieveBalance();
    availableCents = balance.available.find((b) => b.currency === FUND_CURRENCY)?.amount ?? 0;
  } catch {
    return error('balance lookup failed', 502);
  }
  if (amountCents > availableCents) return error('unsettled funds', 409);

  let transfer: Stripe.Transfer;
  try {
    transfer = await ctx.createTransfer(
      {
        amount: amountCents,
        currency: FUND_CURRENCY,
        destination: account.stripe_account_id,
        transfer_group: group,
        // The webhook arm rebuilds the ledger row from this metadata; the within-basis
        // trigger re-derives it against the cycle's frozen columns, so a figure that was
        // "chosen at transfer time" cannot land even if this function is wrong.
        metadata: {
          kind: 'fund_payout',
          edition_id: editionId,
          pool_cents: String(edition.confirmed_pool_cents),
          split_pct: String(edition.split_pct),
          payable_cents: String(payable),
        },
      },
      { idempotencyKey: `fund_payout:${editionId}:${releasedNet}` },
    );
  } catch (e) {
    const type = (e as { type?: string } | null)?.type;
    const code = (e as { code?: string } | null)?.code;
    // A different amount raced the same released-state: someone else's release is in
    // flight — refuse rather than double-move; retry once Stripe lists their transfer.
    if (type === 'StripeIdempotencyError' || code === 'idempotency_error') {
      return error('conflicting release in flight', 409);
    }
    // Stripe's own settled-funds gate — same refusal as our pre-check (belt and braces).
    if (code === 'balance_insufficient') return error('unsettled funds', 409);
    return error('transfer failed', 502);
  }

  // NO ledger write here (rule #6): the execution requests, the webhook records.
  return json({
    transferId: transfer.id,
    editionId,
    amountCents,
    payableCents: payable,
    releasedBeforeCents: releasedNet,
    destinationAccountId: account.stripe_account_id,
  });
}
