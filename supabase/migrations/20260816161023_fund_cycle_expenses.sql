-- #234 / FUND-29 — what the cycle actually cost. Divergence D-16.
-- Source: doc §20 «principali categorie di spesa; eventuali compensi o costi di gestione
-- previsti» · PRD.md:256 «main expense categories · fees and management costs» ·
-- docs/FUND-SPEC.md §"Platform economics".
--
-- THE EX-POST HALF OF A PAIR. #232 (20260815155811) froze the DECLARATION at open —
-- `split_pct`, `cost_fee_statement`, `equity_declared`, immutable for the life of the cycle.
-- Those say what Athanor INTENDED to retain and spend. This table says what it actually
-- spent, and the §20 closing report (#238) is the consumer that puts the two side by side.
-- Cycle one declares 10% and states the retention «copre solo in parte i costi operativi e
-- le commissioni di pagamento; la differenza è volutamente a carico di Athanor» (D16) —
-- that sentence is only checkable against a recorded figure, which is what this is.
--
-- OPERATOR-RECORDED, NOT DERIVED. Nothing computes these rows. Athanor's costs are invoices,
-- Stripe statements and counsel's fees — facts that live outside this database and arrive on
-- their own schedule. A trigger that "derived" an expense would be inventing the number it
-- is supposed to be publishing. Writes are service_role only (rule #2's deny-by-default);
-- reads are public, because FUND-38 publishes «principali categorie di spesa» to a page that
-- an unregistered visitor sees.
--
-- WHY A CHECK-BOUND VOCABULARY, NOT FREE TEXT. The categories are what the public page and
-- the report RENDER — they are product vocabulary, the `closure_reason` pattern
-- (20260815175549). Free text would let two cycles publish «commissioni» and «Stripe» as if
-- they were different things, and no report could ever group across cycles. The list is
-- widened the same way `closure_reason` was: drop the constraint, re-add it with the longer
-- list, in a new migration.
--
-- THE FEE COVERAGE IS NOT A ROW HERE — it is computed at report time. #236
-- (20260816142524) added `fund_contributions.coverage_cents`: the processing cost a
-- contributor OPTIONALLY chose to add so the gift arrives whole. It is tempting to write it
-- here as a negative `payment_processing` expense, and it would be wrong twice over:
--
--   1. This table is what ATHANOR SPENT. Coverage is money MEMBERS gave. Netting it in
--      destroys the gross figure, and «principali categorie di spesa» asks for the gross —
--      a category that silently reports cost-minus-donations is not the category it names.
--   2. `sum(coverage_cents)` is already exact and already recorded per contribution. A
--      second copy here would need a writer keeping it in step with every contribution and
--      every reversal, and #247's rider requires #234's costs and #237's published figures
--      to describe the same money. One source cannot drift from itself.
--
-- So: gross costs here, and a report that wants to show the offset reads it from the
-- contributions. NOTE for #237/#238 — `anon` cannot see `fund_contributions` at all
-- (20260816143114), so a coverage total is not client-computable today and would need a
-- server-side aggregate that does not exist yet. Out of scope here; flagged where it lands.
--
-- SIGNED AMOUNTS, BECAUSE A CORRECTION IS A ROW. A published cost ledger must not be edited
-- into a different past. An overstated expense is corrected by recording the credit
-- (negative `amount_cents`) against the same cycle and category, so the per-category SUM —
-- which is the published figure — comes out right while both facts stay visible. Zero is
-- refused: a row that changes no total is noise in a transparency record.

-- ── the table ───────────────────────────────────────────────────────────────────────────
create table public.fund_cycle_expenses (
  id uuid primary key default gen_random_uuid(),

  -- `restrict`, matching fund_contributions (20260618153032) rather than the cascade the
  -- ballot tables use: an edition carrying a cost record is not deletable, and the record
  -- must not evaporate with it. A cycle's spending is the §20 report's historical evidence.
  edition_id uuid not null references public.fund_editions (id) on delete restrict,

  -- The rendered vocabulary. Six values covering both halves of §20's sentence — the spese
  -- and the «compensi o costi di gestione»:
  --   payment_processing  Stripe's cut on contributions — the cost #236's coverage offsets
  --   payout_transfer     moving money out: Connect transfers, payout and FX charges
  --   platform_operations infrastructure and running costs attributable to this cycle
  --   legal_compliance    counsel, filings, the fiscal/regulatory obligations of a pooled fund
  --   management_fee      §20's «compensi» — compensation for managing the cycle
  --   other               the honest escape hatch; `description` carries the whole burden
  -- `other` exists on purpose. Without it an unforeseen cost is either mis-filed under a
  -- category that does not describe it or left unrecorded, and both are worse for a
  -- transparency record than a named residual. It is the signal that the list needs widening.
  category text not null,
  constraint fund_cycle_expenses_category_check check (
    category in ('payment_processing', 'payout_transfer', 'platform_operations',
                 'legal_compliance', 'management_fee', 'other')
  ),

  -- Positive = a cost. Negative = a credit correcting an earlier row (see header). Never 0.
  amount_cents bigint not null,
  constraint fund_cycle_expenses_amount_cents_check check (amount_cents <> 0),

  -- Mandatory, non-blank: a category alone publishes a number with no account of itself,
  -- and `other` would publish nothing at all. 500 chars is `profiles.bio`'s bound — a line
  -- of explanation, not a document. Mirrored exactly in packages/schemas/src/fund-expense.ts.
  description text not null,
  constraint fund_cycle_expenses_description_check check (
    char_length(btrim(description)) between 1 and 500
  ),

  -- When the cost was incurred, which is not when it was typed: an operator records
  -- January's processing fees in March, and `created_at` would date them to March. A date
  -- rather than a timestamptz — an invoice has a day, not a moment.
  incurred_on date not null default current_date,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.fund_cycle_expenses is
  '#234/FUND-29: the operating costs and service fees actually incurred in one fund cycle — the ex-post half of #232''s frozen declaration, and the source of FUND-38''s «principali categorie di spesa» (doc §20). Operator-recorded: service_role writes, the world reads. Amounts are signed — a correction is a credit row, never an edit. The fee coverage members chose to add (#236 coverage_cents) is NOT recorded here: this table is gross cost, and the offset is computed at report time.';

comment on column public.fund_cycle_expenses.edition_id is
  '#234: the cycle this cost belongs to. ON DELETE RESTRICT — a cycle with a recorded cost is not deletable, because the record is the §20 report''s evidence.';
comment on column public.fund_cycle_expenses.category is
  '#234: the published category (doc §20). CHECK-bound product vocabulary, the closure_reason pattern — the public page and the closing report render these, so a free-text column would make two cycles ungroupable. Widened by drop-and-re-add in a new migration, never by an app.';
comment on column public.fund_cycle_expenses.amount_cents is
  '#234: signed. Positive is a cost; negative is a credit correcting an earlier row in the same cycle and category, so the published per-category SUM is right while both facts stay visible. 0 is refused. Never netted against #236''s coverage_cents — that is members'' money, not Athanor''s spending.';
comment on column public.fund_cycle_expenses.description is
  '#234: what the money was, in one line. NOT NULL and non-blank because a category alone publishes a number with no account of itself — and under ''other'' it is the only account there is.';
comment on column public.fund_cycle_expenses.incurred_on is
  '#234: the day the cost was incurred, which is not the day it was recorded. created_at dates the bookkeeping; this dates the money.';

-- (edition_id, category) leading, so it serves the FK lookup and the ON DELETE RESTRICT
-- check as well as the grouping. `include (amount_cents)` makes the per-cycle sum — the one
-- query the public page runs — an index-only scan that never touches the heap.
create index fund_cycle_expenses_edition_category
  on public.fund_cycle_expenses (edition_id, category) include (amount_cents);

create trigger fund_cycle_expenses_touch_updated_at
  before update on public.fund_cycle_expenses
  for each row execute function public.touch_updated_at();

-- ── grants ──────────────────────────────────────────────────────────────────────────────
-- Revoke-then-grant, the 20260816143114 lesson: the hosted projects auto-grant ALL on new
-- public tables to anon/authenticated via schema default privileges, and a migration that
-- names verbs to revoke ("revoke insert, update, delete") leaves TRUNCATE, REFERENCES and
-- TRIGGER standing — invisibly, because a fresh CI stack does not reproduce it. TRUNCATE is
-- not subject to RLS, so on a table whose only write protection is «there is no policy» the
-- grant IS the protection. `revoke all` first, then name what is allowed.
revoke all on table public.fund_cycle_expenses from anon, authenticated;
grant select on table public.fund_cycle_expenses to anon, authenticated;
grant all on table public.fund_cycle_expenses to service_role;

-- ── RLS ─────────────────────────────────────────────────────────────────────────────────
alter table public.fund_cycle_expenses enable row level security;

-- One policy, and it is a read. There is deliberately no client INSERT/UPDATE/DELETE policy
-- and no admin policy: the operator records these as service_role, which bypasses RLS, so
-- adding an app-facing write path is a decision someone has to make explicitly rather than
-- inherit. #106's restrictive `active_write_*` net is absent for the same reason it is
-- absent on realization_plans — the net gates MEMBERS writing, and no member writes here.
create policy "fund_cycle_expenses_select_public"
  on public.fund_cycle_expenses for select
  to anon, authenticated
  using (true);

-- ── the published shape ─────────────────────────────────────────────────────────────────
-- Per cycle, per category, summed. This exists rather than leaving the sum to the caller
-- because PostgREST does not expose aggregate functions unless they are switched on
-- (`db-aggregates-enabled`, absent from supabase/config.toml and off by default), so a
-- public page reading over the REST API cannot run `sum()` — it would have to fetch every
-- expense row and add them up in the browser, and then two consumers could disagree about
-- the same money (#247's rider). One view, one answer.
--
-- security_invoker: the caller's RLS on fund_cycle_expenses applies. The base table's read
-- is public, so this is public too — deliberately, and by the same policy rather than by a
-- second one that could drift from it.
create view public.fund_edition_expense_totals
with (security_invoker = true) as
select
  e.edition_id,
  e.category,
  sum(e.amount_cents)::bigint as total_cents,
  count(*)::int as entry_count
from public.fund_cycle_expenses e
group by e.edition_id, e.category;

comment on view public.fund_edition_expense_totals is
  '#234/FUND-38: one cycle''s spending, per published category (doc §20 «principali categorie di spesa»). total_cents is the SIGNED sum, so a credit row nets against the cost it corrects. security_invoker — fund_cycle_expenses'' public read governs. A category with no rows is absent rather than zero: the report renders what was spent, not a checklist of what was not.';

revoke all on table public.fund_edition_expense_totals from anon, authenticated;
grant select on table public.fund_edition_expense_totals to anon, authenticated, service_role;
