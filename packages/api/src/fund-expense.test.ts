import { describe, expect, it } from 'vitest';
import type { AthanorClient } from './client';
import {
  FUND_EXPENSE_PAGE_SIZE,
  fundExpenseKeys,
  getFundCycleExpenses,
  getFundEditionExpenseTotals,
} from './fund-expense';

const EDITION = '00000000-0000-0000-0000-0000000000e1';

const uid = (n: number) => `00000000-0000-0000-0000-00000000a${String(n).padStart(3, '0')}`;

const row = (n: number, created_at: string, extra: Record<string, unknown> = {}) => ({
  id: uid(n),
  edition_id: EDITION,
  category: 'payment_processing',
  amount_cents: 12000,
  description: 'Commissioni Stripe sui contributi del ciclo.',
  incurred_on: '2026-08-16',
  created_at,
  updated_at: created_at,
  ...extra,
});

/** Thenable PostgREST-builder stub — the realization-update.test.ts idiom. */
function stub(data: unknown = null, error: unknown = null) {
  const calls: Array<{ method: string; arg: unknown; arg2?: unknown }> = [];
  const chain: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'or', 'order', 'limit']) {
    chain[m] = (arg?: unknown, arg2?: unknown) => {
      calls.push({ method: m, arg, arg2 });
      return chain;
    };
  }
  chain['then'] = (resolve: (v: unknown) => unknown) => resolve({ data, error });
  const from: string[] = [];
  const client = {
    from: (t: string) => {
      from.push(t);
      return chain;
    },
  } as unknown as AthanorClient;
  return { client, calls, from };
}

describe('fundExpenseKeys', () => {
  it('scopes the published totals and the detail ledger separately', () => {
    expect(fundExpenseKeys.all).toEqual(['fundExpense']);
    expect(fundExpenseKeys.totals(EDITION)).toEqual(['fundExpense', 'totals', EDITION]);
    expect(fundExpenseKeys.entries(EDITION)).toEqual(['fundExpense', 'entries', EDITION]);
  });
});

describe('getFundEditionExpenseTotals', () => {
  const total = (category: string, total_cents: number, entry_count = 1) => ({
    edition_id: EDITION,
    category,
    total_cents,
    entry_count,
  });

  /**
   * The view exists because PostgREST exposes no aggregates by default. Reading the table and
   * summing in the caller would let two consumers disagree about the same money, which is
   * what #247's rider forbids between #234's costs and #237's published figures.
   */
  it('reads the view, never the table', async () => {
    const { client, from } = stub([total('payment_processing', 10000, 2)]);
    await getFundEditionExpenseTotals(client, EDITION);
    expect(from).toEqual(['fund_edition_expense_totals']);
    expect(from).not.toContain('fund_cycle_expenses');
  });

  it('scopes to one cycle and orders by category so the page renders stably', async () => {
    const { client, calls } = stub([total('payment_processing', 10000, 2)]);
    await getFundEditionExpenseTotals(client, EDITION);
    expect(calls.find((c) => c.method === 'eq')).toEqual({
      method: 'eq',
      arg: 'edition_id',
      arg2: EDITION,
    });
    expect(calls.find((c) => c.method === 'order')).toEqual({
      method: 'order',
      arg: 'category',
      arg2: { ascending: true },
    });
  });

  it('returns the signed total — a credit nets against the cost it corrects', async () => {
    const { client } = stub([total('payment_processing', 10000, 2)]);
    const [line] = await getFundEditionExpenseTotals(client, EDITION);
    expect(line?.total_cents).toBe(10000);
    expect(line?.entry_count).toBe(2);
  });

  it('returns absent categories as absent, not as zero rows', async () => {
    const { client } = stub([
      total('payment_processing', 10000, 2),
      total('legal_compliance', 90000),
    ]);
    const lines = await getFundEditionExpenseTotals(client, EDITION);
    expect(lines.map((l) => l.category)).toEqual(['payment_processing', 'legal_compliance']);
    expect(lines).toHaveLength(2);
  });

  it('throws a PostgREST error rather than returning a half-published figure', async () => {
    const { client } = stub(null, { message: 'boom' });
    await expect(getFundEditionExpenseTotals(client, EDITION)).rejects.toEqual({ message: 'boom' });
  });

  it('rejects a row the view cannot actually produce', async () => {
    const { client } = stub([{ ...total('payment_processing', 10000), total_cents: null }]);
    await expect(getFundEditionExpenseTotals(client, EDITION)).rejects.toThrow();
  });
});

describe('getFundCycleExpenses', () => {
  it('orders by (created_at desc, id desc) and sends no offset (rule #9)', async () => {
    const { client, calls } = stub([row(1, '2026-08-16T10:00:00Z')]);
    await getFundCycleExpenses(client, EDITION);

    const orders = calls.filter((c) => c.method === 'order');
    expect(orders.map((c) => c.arg)).toEqual(['created_at', 'id']);
    expect(orders.every((c) => (c.arg2 as { ascending: boolean }).ascending === false)).toBe(true);
    expect(calls.some((c) => c.method === 'or')).toBe(false);
    expect(calls.find((c) => c.method === 'limit')?.arg).toBe(FUND_EXPENSE_PAGE_SIZE);
  });

  /**
   * `incurred_on` is what the row displays but is not the sort: it is not unique, and an
   * operator backdating an old invoice would insert into the middle of a page a reader is
   * already holding.
   */
  it('does not sort by incurred_on', async () => {
    const { client, calls } = stub([]);
    await getFundCycleExpenses(client, EDITION);
    expect(calls.filter((c) => c.method === 'order').map((c) => c.arg)).not.toContain(
      'incurred_on',
    );
  });

  it('sends a keyset predicate once a cursor exists', async () => {
    const { client, calls } = stub([]);
    await getFundCycleExpenses(client, EDITION, {
      cursor: { ts: '2026-08-16T10:00:00Z', id: uid(2) },
    });
    expect(calls.find((c) => c.method === 'or')?.arg).toBe(
      `created_at.lt.2026-08-16T10:00:00Z,and(created_at.eq.2026-08-16T10:00:00Z,id.lt.${uid(2)})`,
    );
  });

  it('returns a cursor only when the page is full', async () => {
    const full = stub([row(1, '2026-08-16T10:00:00Z'), row(2, '2026-08-16T09:00:00Z')]);
    const page = await getFundCycleExpenses(full.client, EDITION, { limit: 2 });
    expect(page.nextCursor).toEqual({ ts: '2026-08-16T09:00:00Z', id: uid(2) });

    const partial = stub([row(1, '2026-08-16T10:00:00Z')]);
    const last = await getFundCycleExpenses(partial.client, EDITION, { limit: 2 });
    expect(last.nextCursor).toBeNull();
  });

  it('parses the credit rows as readily as the cost rows', async () => {
    const { client } = stub([row(1, '2026-08-16T10:00:00Z', { amount_cents: -2000 })]);
    const { rows } = await getFundCycleExpenses(client, EDITION);
    expect(rows[0]?.amount_cents).toBe(-2000);
  });

  it('throws rather than swallowing a PostgREST error', async () => {
    const { client } = stub(null, { message: 'boom' });
    await expect(getFundCycleExpenses(client, EDITION)).rejects.toEqual({ message: 'boom' });
  });
});
