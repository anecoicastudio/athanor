-- #216 — Migration slice (iii): failure states — closure reason, snapshot, carry-forward.
-- FUND-42, FUND-43, FUND-45 · divergence D-5 (closure columns) · decisions D33, D34
-- (docs/FUND-DECISIONS.md) · FUND-SPEC §5, §7.
--
-- Shape only. #220 writes the announcement snapshot, #221 writes closure and rollover;
-- this migration makes the failure states *representable and constrained* so those
-- transitions have columns to write and CHECKs to answer to.
--
--   • closure_reason — why a cycle closed: realized, or one of the three void causes
--     (below the FUND-42 floor, below the FUND-43 quorum, winner declined — D33).
--     Present exactly when phase = 'closed': a failure must be nameable, an open cycle
--     must not carry one. D33's *post-tranche-one* failure branch («the realization is
--     declared failed», published through the D26 path) is deliberately NOT in this
--     vocabulary — whether it is a fifth closure_reason or a realization-side state is
--     #221's call, and the CHECK extends the same way fund_editions_phase_check did
--     (20260815075408: drop → re-add).
--   • confirmed_pool_cents — the FUND-42 announcement snapshot of the pool. One-way
--     phase bind only: it must not exist before 'announcement' (nothing has snapshotted
--     yet), but *when* it becomes mandatory is #220's announcement-transition semantics —
--     a quorum/floor void may close a cycle with or without a usable snapshot, and
--     forcing "present from announcement on" here would prejudge that. Deliberately no
--     presence requirement; #220 adds one if its transition guarantees it.
--   • carried_in_cents — the FUND-45 carry-forward a successor cycle starts with.
--     NOT NULL DEFAULT 0: the counter renders it as a distinct amount, never folded
--     into raised_cents, so it must always be readable — 0 is "nothing carried", not
--     "unknown". #221's rollover writes the non-zero case.
--   • dream_candidacies.status gains 'voided' — the D33/D34 terminal state for
--     candidacies of a voided cycle. Not a rejection: dream_candidacies_rejection_reasons_shape
--     (20260815164809) already forces rejection_reasons IS NULL through its else-branch,
--     and is_on_ballot() (an allowlist — 'shortlisted','winner') already excludes it
--     from all five ballot call sites without an edit.
--   • fund_contributions.edition_id becomes immutable (trigger). Rule 6: a contribution
--     row is a cache of a Stripe payment made to ONE cycle; re-pointing it would detach
--     the row from its Stripe reconciliation trail. Nothing legitimately updates it —
--     the webhook upserts on stripe_checkout_session_id with ignoreDuplicates,
--     reverseContribution writes only status, the GDPR erasure only re-points
--     profile_id to the tombstone — so the trigger forbids what nothing does, before
--     #221's rollover code is ever tempted to "move" contributions to the successor.
--     FUND-45 carries value forward as carried_in_cents, never by re-pointing rows.
--
-- Existing rows: staging's live cycle sits at phase = 'voting' with none of the new
-- columns set — it passes the not-closed branch of every shape CHECK, and
-- carried_in_cents backfills to the default 0. Production carries no fund_editions row.

-- ── 1. closure_reason (D33) ─────────────────────────────────────────────────────────────
alter table public.fund_editions
  add column closure_reason text,
  add constraint fund_editions_closure_reason_check check (
    closure_reason in ('realized','voided_underfunded','voided_quorum','voided_declined')
  ),
  add constraint fund_editions_closure_reason_shape check (
    (phase = 'closed') = (closure_reason is not null)
  );

comment on column public.fund_editions.closure_reason is
  '#216/D33: why the cycle closed — realized, or voided below the FUND-42 floor / below the FUND-43 quorum / winner declined. Present exactly when phase = ''closed'' (fund_editions_closure_reason_shape). #221 writes it at the closure transition.';

-- ── 2. confirmed_pool_cents (FUND-42) — one-way phase bind, see header ──────────────────
alter table public.fund_editions
  add column confirmed_pool_cents bigint,
  add constraint fund_editions_confirmed_pool_cents_check check (
    confirmed_pool_cents is null or confirmed_pool_cents >= 0
  ),
  add constraint fund_editions_confirmed_pool_cents_shape check (
    confirmed_pool_cents is null or phase in ('announcement','realization','closed')
  );

comment on column public.fund_editions.confirmed_pool_cents is
  '#216/FUND-42: the announcement snapshot of the pool — the number the floor comparison and the split are computed from. NULL until #220''s announcement transition writes it; never present before ''announcement'' (fund_editions_confirmed_pool_cents_shape).';

-- ── 3. carried_in_cents (FUND-45) ───────────────────────────────────────────────────────
alter table public.fund_editions
  add column carried_in_cents bigint not null default 0,
  add constraint fund_editions_carried_in_cents_check check (carried_in_cents >= 0);

comment on column public.fund_editions.carried_in_cents is
  '#216/FUND-45: cents carried in from a voided predecessor cycle. Always readable — the ticker renders it as a distinct amount, never folded into raised_cents; 0 means nothing carried. #221''s rollover writes the non-zero case.';

-- ── 4. status vocabulary gains 'voided' (D33/D34) ───────────────────────────────────────
-- Same drop → re-add as fund_editions_phase_check (20260815075408). No data map needed:
-- no existing status changes meaning. rejection_reasons stays NULL on 'voided' via the
-- else-branch of dream_candidacies_rejection_reasons_shape; is_on_ballot()'s allowlist
-- keeps 'voided' off the ballot, the list feed, the public select and the vote path.
alter table public.dream_candidacies drop constraint dream_candidacies_status_check;
alter table public.dream_candidacies
  add constraint dream_candidacies_status_check check (
    status in ('submitted','screening','shortlisted','rejected','winner','voided')
  );

-- ── 5. fund_contributions.edition_id is immutable ───────────────────────────────────────
-- Trigger, not a policy: RLS already denies every client write on fund_contributions,
-- and the only remaining writer is the service role, which RLS cannot restrain (the
-- fund_editions_freeze_declarations precedent, 20260815155811). Unconditional refusal
-- the moment the value would actually change — IS DISTINCT FROM keeps idempotent
-- same-value write-backs legal.
create function public.fund_contributions_edition_frozen()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception
    'fund_contributions.edition_id is immutable (#216): a contribution is the cache of a Stripe payment made to one cycle; carry value forward as carried_in_cents, never by re-pointing rows'
    using errcode = 'P0001';
end;
$$;

create trigger fund_contributions_freeze_edition
  before update on public.fund_contributions
  for each row
  when (old.edition_id is distinct from new.edition_id)
  execute function public.fund_contributions_edition_frozen();
