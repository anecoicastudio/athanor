import { z } from 'zod';
import type Stripe from 'npm:stripe@22';
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { error, json } from '../_shared/respond.ts';
import { logStripeFailure } from '../_shared/stripe-error.ts';

// The transfer-executing path (#247, ruling #244): #248's pg_cron sweep and the operator
// call this to move a tranche of a cycle's payable to the winner's connected account.
// Design-doc pattern: separate charges and transfers — the transfer happens HERE, later,
// on a condition, never via transfer_data at charge time. Rule #6 division of labour:
// this function REQUESTS the transfer from Stripe and writes no database row; the
// stripe-webhook transfer.created arm RECORDS it in fund_payout_ledger. Everything is
// injected (repo convention: DI over mocks); deliberately does NOT import
// ../_shared/stripe.ts — only type-level `npm:stripe`; ../_shared/stripe-error.ts is safe to
// import for real, since it reads no env and builds no client. #541 made that module lazy, so the
// import would no longer demand STRIPE_SECRET_KEY in a test env — and, the reason that
// mattered, so that reading the secret can no longer happen ahead of this function's gate.
// Transport shell in index.ts (requireServiceRole first).
//
// #231's «no verification, no money» gate now occupies the slot this file reserved for it.
// Every release is phase-targeted: a tranche names the plan phase it funds, and a phase
// whose verification is not RECORDED (realization_plan_phases.verified_at, written only by
// the service-role verify_plan_phase() transition) refuses before any Stripe call. FUND-53
// «il denaro raccolto dovrà essere utilizzato secondo il progetto approvato» is an EX-ANTE
// gate: there is deliberately no path that releases first and reconciles afterwards.

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

// An explicit release names BOTH the cycle and the phase it funds. planPhaseId is required,
// not optional: an unattributed release is precisely the ungated money FUND-53 forbids, and
// making it omissible would leave the gate switchable off from the request body.
// (fund_payout_ledger.plan_phase_id stays nullable forever for the pre-plan corpus — those
// rows are history, not something this path can still create.)
const payload = z
  .object({
    editionId: z.string().uuid(),
    planPhaseId: z.string().uuid(),
    amountCents: z.number().int().positive(),
  })
  .strict();

export type ReleaseFundPayoutCtx = {
  /** service-role client — reads fund_editions / dream_candidacies / payout_accounts / plan phases */
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
 * Net released AGAINST ONE PHASE, read from the same Stripe list as the cycle-level figure
 * rather than from fund_payout_ledger.plan_phase_id. Same reason ruling #244 gives for the
 * cycle cap: the ledger is a webhook cache that may lag a delivery, and the per-phase cap
 * has to hold against money that actually moved. The attribution rides the transfer's own
 * metadata, so Stripe can answer this without us.
 */
export function phaseReleasedNetCents(
  transfers: (Pick<Stripe.Transfer, 'amount' | 'amount_reversed'> & {
    // Optional: the pre-#231 corpus carries no attribution, and Stripe omits the key
    // entirely rather than sending an empty one.
    metadata?: Stripe.Metadata | null;
  })[],
  planPhaseId: string,
): number {
  return releasedNetCents(transfers.filter((t) => t.metadata?.plan_phase_id === planPhaseId));
}

/** A refusal (4xx, no money moved) or the transfer that was requested. */
type Outcome =
  | { ok: false; message: string; status: number }
  | {
      ok: true;
      transferId: string;
      editionId: string;
      planPhaseId: string;
      amountCents: number;
      payableCents: number;
      releasedBeforeCents: number;
      phaseReleasedBeforeCents: number;
      destinationAccountId: string;
    };

const refuse = (message: string, status: number): Outcome => ({ ok: false, message, status });

type PhaseRow = {
  amount_cents: number;
  verified_at: string | null;
  realization_plans: { edition_id: string; published_at: string | null } | null;
};

/**
 * Refusal ladder, then one Stripe transfer. Refusals are 4xx and move no money:
 * unknown cycle, no declared/confirmed winner, wrong phase (transfers run in
 * announcement/realization, and on a 'closed'+'realized' cycle whose payable remainder
 * was already accounted as disbursed by close_cycle — a failed or voided closure carried
 * its remainder to the successor, so those refuse), unknown plan phase, a phase from
 * another cycle, an unpublished plan, an UNVERIFIED phase (#231, the gate), unready
 * account (#245's flags default false — fail closed), would-exceed at cycle grain (the
 * #244 cap against Stripe-listed released-net) and at phase grain (the plan's own costing),
 * and unsettled (the transfer must fit inside Stripe's AVAILABLE balance — ruling #244:
 * settled funds only, never pending balances).
 *
 * `amountCents` omitted means "this phase's whole remaining headroom" and is how the sweep
 * calls in. That is not the sweep inventing a figure — the amount is the phase's own
 * `amount_cents`, costed by the winner and frozen at publication, less what already moved
 * against it. An operator naming an amount explicitly still gets it bounded by the same cap.
 *
 * Idempotency: the Stripe key embeds the released-net observed at decision time, so a
 * concurrent duplicate of the SAME release replays the original transfer instead of
 * minting a second, and a DIFFERENT amount racing the same state dies with Stripe's
 * idempotency conflict (409 here). The phase is deliberately NOT part of the key: two
 * phases released concurrently would both observe the same released-net, and a
 * phase-keyed idempotency key would let both mint against one headroom reading.
 * A follow-up tranche is accepted as soon as the previous transfer is visible in
 * Stripe's own list — no webhook round-trip needed.
 */
async function releaseOne(
  ctx: ReleaseFundPayoutCtx,
  target: { editionId: string; planPhaseId: string; amountCents?: number },
): Promise<Outcome> {
  const { admin } = ctx;
  const { editionId, planPhaseId } = target;

  const { data: editionData, error: edErr } = await admin
    .from('fund_editions')
    .select(
      'phase,closure_reason,winner_candidacy_id,winner_confirmed_at,confirmed_pool_cents,split_pct',
    )
    .eq('id', editionId)
    .maybeSingle();
  if (edErr) return refuse('edition lookup failed', 500);
  if (!editionData) return refuse('edition not found', 404);
  const edition = editionData as EditionRow;

  if (!edition.winner_candidacy_id) return refuse('no winner declared', 409);
  if (!edition.winner_confirmed_at) return refuse('viability not confirmed', 409);
  const phaseOk =
    edition.phase === 'announcement' ||
    edition.phase === 'realization' ||
    (edition.phase === 'closed' && edition.closure_reason === 'realized');
  if (!phaseOk) {
    // A failed/voided closure carried its unreleased remainder to the successor — that
    // money is no longer this cycle's to move. Pre-announcement phases have no snapshot.
    return refuse(edition.phase === 'closed' ? 'cycle closed' : 'release out of phase', 409);
  }
  if (edition.confirmed_pool_cents === null) return refuse('no confirmed pool', 409);

  // ── #231's gate, before any Stripe call ───────────────────────────────────────────────
  // Read in one shot with the plan so a phase from another cycle and an unpublished plan
  // are both answerable here. The identical rules exist in the database (the ledger's
  // within-basis trigger, 20260816073905:366-385) and will refuse the WEBHOOK's write if
  // this layer is wrong — but a trigger refusing after the money moved leaves a stuck event
  // and a transfer with no ledger row, so this is the gate that must actually hold.
  const { data: phaseData, error: phErr } = await admin
    .from('realization_plan_phases')
    .select('amount_cents,verified_at,realization_plans!inner(edition_id,published_at)')
    .eq('id', planPhaseId)
    .maybeSingle();
  if (phErr) return refuse('plan phase lookup failed', 500);
  if (!phaseData) return refuse('plan phase not found', 404);
  const phase = phaseData as unknown as PhaseRow;
  const plan = phase.realization_plans;
  if (!plan) return refuse('plan phase not found', 404);
  if (plan.edition_id !== editionId) return refuse('plan phase belongs to another cycle', 409);
  // A draft plan is not the commitment tranches release against (FUND-53). Unreachable in
  // practice — publication is what moves a cycle into 'realization' — and asserted anyway,
  // because "unreachable" here depends on a transition in another file.
  if (!plan.published_at) return refuse('plan not published', 409);
  // THE GATE. No verification, no money.
  if (!phase.verified_at) return refuse('phase not verified', 409);

  const { data: candidacy, error: candErr } = await admin
    .from('dream_candidacies')
    .select('profile_id')
    .eq('id', edition.winner_candidacy_id)
    .maybeSingle();
  if (candErr) return refuse('winner lookup failed', 500);
  const winnerProfileId = (candidacy as { profile_id: string | null } | null)?.profile_id ?? null;
  // An erased winner has no destination — same refusal as never having onboarded.
  if (!winnerProfileId) return refuse('no payout account', 409);

  const { data: accountData, error: accErr } = await admin
    .from('payout_accounts')
    .select('stripe_account_id,charges_enabled,payouts_enabled')
    .eq('profile_id', winnerProfileId)
    .maybeSingle();
  if (accErr) return refuse('payout account lookup failed', 500);
  if (!accountData) return refuse('no payout account', 409);
  const account = accountData as {
    stripe_account_id: string;
    charges_enabled: boolean;
    payouts_enabled: boolean;
  };
  // Both flags, both required, both default false until Stripe's KYC says otherwise —
  // and account.updated revokes them again when requirements lapse (W13 both directions).
  if (!account.charges_enabled || !account.payouts_enabled) {
    return refuse('payout account not ready', 409);
  }

  const payable = payableCents(edition.confirmed_pool_cents, edition.split_pct);
  const group = transferGroup(editionId);

  let transfers: Stripe.Transfer[];
  try {
    transfers = await ctx.listTransfers(group);
  } catch (e) {
    logStripeFailure('release-fund-payout: transfers.list', e);
    return refuse('transfer listing failed', 502);
  }
  const releasedNet = releasedNetCents(transfers);
  const phaseReleasedNet = phaseReleasedNetCents(transfers, planPhaseId);
  const phaseHeadroom = phase.amount_cents - phaseReleasedNet;
  // The sweep asks for whatever the phase still has coming; the operator names a figure.
  const amountCents = target.amountCents ?? phaseHeadroom;
  // Only reachable on the sweep path (the payload schema requires a positive integer), and
  // it is the sweep's normal "nothing due here" answer, not an anomaly.
  if (amountCents <= 0) return refuse('phase fully released', 409);
  if (amountCents > payable - releasedNet) return refuse('would exceed declared payable', 409);
  // The plan's own costing binds too: a phase costed at 5.000 € cannot release 10.000 €
  // even when the cycle's payable would allow it, or #234's recorded costs and #237's
  // published figures disagree with the plan they both cite.
  if (amountCents > phaseHeadroom) return refuse('would exceed phase amount', 409);

  let availableCents: number;
  try {
    const balance = await ctx.retrieveBalance();
    availableCents = balance.available.find((b) => b.currency === FUND_CURRENCY)?.amount ?? 0;
  } catch (e) {
    logStripeFailure('release-fund-payout: balance.retrieve', e);
    return refuse('balance lookup failed', 502);
  }
  if (amountCents > availableCents) return refuse('unsettled funds', 409);

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
        // plan_phase_id is the one key #228 left this issue to add: it is what makes the
        // released tranche attributable to the phase whose verification released it.
        metadata: {
          kind: 'fund_payout',
          edition_id: editionId,
          plan_phase_id: planPhaseId,
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
      return refuse('conflicting release in flight', 409);
    }
    // Stripe's own settled-funds gate — same refusal as our pre-check (belt and braces).
    if (code === 'balance_insufficient') return refuse('unsettled funds', 409);
    // Everything past the two expected refusals is a genuine failure, and this was the last
    // Stripe caller in the repo that discarded one (#416's rule, missed here). Two bare catches
    // around Stripe calls remain on purpose and are not the same thing — stripe-webhook's
    // signature gate and create-payout-onboarding's best-effort account cleanup each discard a
    // designed outcome rather than a failure. It matters more since #541: an unset
    // STRIPE_SECRET_KEY now arrives HERE rather than at boot.
    logStripeFailure('release-fund-payout: transfers.create', e);
    return refuse('transfer failed', 502);
  }

  // NO ledger write here (rule #6): the execution requests, the webhook records.
  return {
    ok: true,
    transferId: transfer.id,
    editionId,
    planPhaseId,
    amountCents,
    payableCents: payable,
    releasedBeforeCents: releasedNet,
    phaseReleasedBeforeCents: phaseReleasedNet,
    destinationAccountId: account.stripe_account_id,
  };
}

/** One enumerated candidate: a verified phase on a published plan. */
type DuePhaseRow = {
  id: string;
  realization_plans: { edition_id: string } | null;
};

/**
 * #248's sweep, live since #231. Enumerates every VERIFIED phase of a PUBLISHED plan and
 * asks the ladder above about each; the ladder decides whether anything moves, exactly the
 * division of labour the cron wrapper's header states (20260816071602:5-10).
 *
 * The enumeration is deliberately loose — verified + published, nothing else. Cycle phase,
 * account readiness, both caps and settlement are re-checked per candidate by releaseOne,
 * so a candidate that cannot pay simply refuses and is counted. Duplicating those
 * predicates in the query would create a second place for the eligibility rules to live,
 * which is what the wrapper refuses to do and what this would undo one layer down.
 *
 * Refusals are the normal case (a phase fully released last night refuses 'phase fully
 * released'), so they are counted rather than raised: a sweep that 500s because one cycle's
 * winner has not finished onboarding would stop paying every other cycle.
 */
async function sweep(ctx: ReleaseFundPayoutCtx): Promise<Response> {
  const { data, error: dueErr } = await ctx.admin
    .from('realization_plan_phases')
    .select('id,realization_plans!inner(edition_id,published_at)')
    .not('verified_at', 'is', null)
    .not('realization_plans.published_at', 'is', null);
  if (dueErr) return error('due tranche lookup failed', 500);

  const due = (data ?? []) as unknown as DuePhaseRow[];
  let transfersRequested = 0;
  const refusals: Record<string, number> = {};
  for (const row of due) {
    const editionId = row.realization_plans?.edition_id;
    if (!editionId) continue;
    const outcome = await releaseOne(ctx, { editionId, planPhaseId: row.id });
    if (outcome.ok) transfersRequested += 1;
    else refusals[outcome.message] = (refusals[outcome.message] ?? 0) + 1;
  }
  // The refusal tally rides the response so a sweep that moved nothing says WHY — the
  // difference between "every phase is already paid" and "every winner is unonboarded" is
  // not visible from a bare zero.
  return json({ mode: 'sweep', dueTranches: due.length, transfersRequested, refusals });
}

export async function releaseFundPayout(
  ctx: ReleaseFundPayoutCtx,
  req: Request,
): Promise<Response> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return error('invalid json', 400);
  }

  if (sweepPayload.safeParse(body).success) return await sweep(ctx);

  const parsed = payload.safeParse(body);
  if (!parsed.success) return error('invalid payload', 400);

  const outcome = await releaseOne(ctx, parsed.data);
  if (!outcome.ok) return error(outcome.message, outcome.status);
  const { ok: _ok, ...response } = outcome;
  return json(response);
}
