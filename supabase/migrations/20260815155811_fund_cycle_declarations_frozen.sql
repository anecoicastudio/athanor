-- #232 — The declared per-cycle economics become mandatory and frozen at open.
-- FUND-27, FUND-30 · decisions D15, D16 (docs/FUND-DECISIONS.md) · FUND-SPEC §5.
--
-- 20260815075408 added split_pct / cost_fee_statement / equity_declared as nullable shape
-- only and deferred their semantics here. Two properties land now, both DB-enforced:
--
--   1. A cycle cannot open without its declarations. "Open" means row creation: there is
--      no draft phase and no app-level creation surface — rows are born by operator/seed
--      SQL already in a live phase — so NOT NULL with NO DEFAULT is the forcing function,
--      identical to the min_* trio (FUND-SPEC §5). The two text columns additionally
--      refuse blank strings: '' would satisfy NOT NULL while defeating the disclosure.
--
--   2. Declarations are immutable once the cycle exists. Mechanism: a BEFORE UPDATE
--      TRIGGER, not a policy — RLS already denies every client write on fund_editions,
--      and the only remaining writer is the service role, which RLS cannot restrain.
--      The trigger raises whenever any of the three values would actually change
--      (IS DISTINCT FROM — writing the same value back stays legal); phase transitions,
--      ballot windows and winner writes are untouched. There is no unfreeze branch, not
--      even on closed rows: a past cycle's declaration is the §20 report's historical
--      record.
--
-- Backfill: staging's seeded 2027 world row is the only pre-existing row anywhere
-- (production carries no fund_editions row — FUND-SPEC §6 launch state). Cycle one
-- declares 10%, knowingly subsidised (D16), and no equity — §11's «eventuali diritti
-- societari» makes the stake optional, and declaring "none" is itself the declaration.

-- ── 1. Backfill the known staging row, then tighten ─────────────────────────────────────
update public.fund_editions
   set split_pct          = coalesce(split_pct, 10),
       cost_fee_statement = coalesce(cost_fee_statement,
         'Per questo ciclo Athanor trattiene il 10%. La percentuale copre solo in parte i costi operativi e le commissioni di pagamento; la differenza è volutamente a carico di Athanor. I costi reali sono pubblicati nel report di fine ciclo.'),
       equity_declared    = coalesce(equity_declared,
         'Nessuna partecipazione societaria nel progetto per questo ciclo.');

alter table public.fund_editions
  alter column split_pct set not null,
  alter column cost_fee_statement set not null,
  alter column equity_declared set not null,
  add constraint fund_editions_cost_fee_statement_not_blank
    check (btrim(cost_fee_statement) <> ''),
  add constraint fund_editions_equity_declared_not_blank
    check (btrim(equity_declared) <> '');

-- ── 2. Frozen at open ───────────────────────────────────────────────────────────────────
create function public.fund_editions_declarations_frozen()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception
    'declared economics are frozen at open (#232): split_pct, cost_fee_statement and equity_declared cannot change on an existing cycle'
    using errcode = 'P0001';
end;
$$;

create trigger fund_editions_freeze_declarations
  before update on public.fund_editions
  for each row
  when (
    old.split_pct is distinct from new.split_pct
    or old.cost_fee_statement is distinct from new.cost_fee_statement
    or old.equity_declared is distinct from new.equity_declared
  )
  execute function public.fund_editions_declarations_frozen();

-- ── 3. Column prose follows the tightened truth ─────────────────────────────────────────
comment on column public.fund_editions.split_pct is
  'FUND-27/D15: the percentage Athanor retains this cycle (dream share = 100 − split_pct). NOT NULL, no default, frozen at open (fund_editions_freeze_declarations, #232). Cycle one declares 10, knowingly subsidised (D16).';
comment on column public.fund_editions.cost_fee_statement is
  'FUND-27: the declared operating-costs and service-fees statement for this cycle, published before the collection opens. NOT NULL, non-blank, frozen at open (#232).';
comment on column public.fund_editions.equity_declared is
  'FUND-30/D15: the declared equity participation for this cycle — "none" is a valid declaration. Declared before contributions open; the instrument is negotiated inside what was declared, never outside it. NOT NULL, non-blank, frozen at open (#232).';
