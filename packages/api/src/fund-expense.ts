import {
  type FundCycleExpenseRow,
  type FundEditionExpenseTotal,
  fundCycleExpenseSchema,
  fundEditionExpenseTotalSchema,
} from '@athanor/schemas';
import type { AthanorClient } from './client';
import { keysetFilter, nextCursorOf } from './pagination';

export const fundExpenseKeys = {
  all: ['fundExpense'] as const,
  totals: (editionId: string) => [...fundExpenseKeys.all, 'totals', editionId] as const,
  entries: (editionId: string) => [...fundExpenseKeys.all, 'entries', editionId] as const,
};

/** Cursor position in the ledger's `(created_at desc, id desc)` order. */
export type FundCycleExpenseCursor = { ts: string; id: string };

/** One page of the detail ledger. A cycle's costs are read line by line, not skimmed. */
export const FUND_EXPENSE_PAGE_SIZE = 50;

/**
 * The published figure (#234/FUND-38): one cycle's spending, per category (doc §20
 * «principali categorie di spesa»).
 *
 * Reads the view rather than summing here, and that is the point of the view existing:
 * PostgREST exposes no aggregate functions unless `db-aggregates-enabled` is switched on, so
 * the alternative is fetching every expense row and adding them up in the caller — at which
 * point two consumers can disagree about the same money, which is exactly what #247's rider
 * forbids between #234's costs and #237's published figures. One view, one answer.
 *
 * Ordered by category so the page renders the same sequence every load — the view's own order
 * is a hash-aggregate's, which is to say none. No cursor: the result is at most one row per
 * category in a CHECK-bound vocabulary, so the whole set is the page.
 *
 * WHAT THIS DOES NOT RETURN: the fee coverage members chose to add. That is
 * `fund_contributions.coverage_cents` — members' money, not Athanor's spending — and these
 * totals are deliberately gross. A report that wants to show the offset computes it from the
 * contributions; note that `anon` cannot read that table at all, so a public page cannot do
 * it client-side today and would need a server-side aggregate that does not exist yet.
 */
export async function getFundEditionExpenseTotals(
  client: AthanorClient,
  editionId: string,
): Promise<FundEditionExpenseTotal[]> {
  const { data, error } = await client
    .from('fund_edition_expense_totals')
    .select('*')
    .eq('edition_id', editionId)
    .order('category', { ascending: true });

  if (error) throw error;
  return (data ?? []).map((row) => fundEditionExpenseTotalSchema.parse(row));
}

/**
 * The detail behind the totals (#234): every cost recorded against one cycle, newest first.
 *
 * Keyset, never offset (rule #9). The ordering column pair is `(created_at, id)` rather than
 * `incurred_on` — `incurred_on` is the day the money went and is what the row DISPLAYS, but
 * it is not unique and an operator backdating an old invoice would insert into the middle of
 * a page a reader is already holding. Record order is stable under exactly that.
 *
 * The sort is a small one: `fund_cycle_expenses_edition_category` serves the `edition_id`
 * filter on its leading column, and one cycle's bookkeeping is tens of rows, so there is no
 * separate feed index to maintain for an ordering the public page does not group by.
 */
export async function getFundCycleExpenses(
  client: AthanorClient,
  editionId: string,
  {
    cursor,
    limit = FUND_EXPENSE_PAGE_SIZE,
  }: { cursor?: FundCycleExpenseCursor | null; limit?: number } = {},
): Promise<{ rows: FundCycleExpenseRow[]; nextCursor: FundCycleExpenseCursor | null }> {
  let q = client
    .from('fund_cycle_expenses')
    .select('*')
    .eq('edition_id', editionId)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(limit);

  if (cursor) {
    q = q.or(keysetFilter('created_at', 'id', cursor.ts, cursor.id, 'lt'));
  }

  const { data, error } = await q;
  if (error) throw error;

  const rows = (data ?? []).map((row) => fundCycleExpenseSchema.parse(row));
  return {
    rows,
    nextCursor: nextCursorOf(rows, limit, (last) => ({ ts: last.created_at, id: last.id })),
  };
}
