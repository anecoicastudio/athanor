import { describe, expect, it } from 'vitest';
import {
  FUND_EXPENSE_CATEGORIES,
  fundCycleExpenseInsertSchema,
  fundCycleExpenseSchema,
  fundEditionExpenseTotalSchema,
  fundExpenseCategorySchema,
} from './fund-expense';

const EDITION = '00000000-0000-0000-0000-0000000000e1';

const row = (extra: Record<string, unknown> = {}) => ({
  id: '00000000-0000-0000-0000-00000000a001',
  edition_id: EDITION,
  category: 'payment_processing',
  amount_cents: 12000,
  description: 'Commissioni Stripe sui contributi del ciclo.',
  incurred_on: '2026-08-16',
  created_at: '2026-08-16T10:00:00Z',
  updated_at: '2026-08-16T10:00:00Z',
  ...extra,
});

describe('FUND_EXPENSE_CATEGORIES', () => {
  /**
   * The vocabulary and `fund_cycle_expenses_category_check` are the same list. This asserts
   * the TS half; the SQL half is asserted in 0120_fund_cycle_expenses.test.sql, which inserts
   * one row of every category and refuses one outside it. Two tests, because a drift between
   * them is exactly the failure this pair exists to catch.
   */
  it('is the six published categories of doc §20, in the migration CHECK order', () => {
    expect(FUND_EXPENSE_CATEGORIES).toEqual([
      'payment_processing',
      'payout_transfer',
      'platform_operations',
      'legal_compliance',
      'management_fee',
      'other',
    ]);
  });

  it('covers both halves of §20 — the spese and the «compensi o costi di gestione»', () => {
    expect(FUND_EXPENSE_CATEGORIES).toContain('management_fee');
    expect(FUND_EXPENSE_CATEGORIES).toContain('payment_processing');
  });

  it('refuses a category the public page could not render', () => {
    expect(fundExpenseCategorySchema.safeParse('marketing').success).toBe(false);
    expect(fundExpenseCategorySchema.safeParse('').success).toBe(false);
  });
});

describe('fundCycleExpenseSchema', () => {
  it('accepts a recorded cost', () => {
    expect(fundCycleExpenseSchema.parse(row())).toEqual(row());
  });

  /**
   * The design property: a published cost is never edited into a different past, so an
   * overstatement is corrected by recording the credit as its own negative row.
   */
  it('accepts a negative amount — a credit is a row, not an edit', () => {
    expect(fundCycleExpenseSchema.parse(row({ amount_cents: -2000 })).amount_cents).toBe(-2000);
  });

  it('mirrors the description bound exactly: 500 passes, 501 fails', () => {
    expect(fundCycleExpenseSchema.safeParse(row({ description: 'x'.repeat(500) })).success).toBe(
      true,
    );
    expect(fundCycleExpenseSchema.safeParse(row({ description: 'x'.repeat(501) })).success).toBe(
      false,
    );
  });

  it('refuses a blank account of the money — under `other` it is the only one there is', () => {
    expect(fundCycleExpenseSchema.safeParse(row({ description: '   ' })).success).toBe(false);
    expect(fundCycleExpenseSchema.safeParse(row({ description: '' })).success).toBe(false);
  });

  it('does not rewrite a row it read — a DB value round-trips byte-identical', () => {
    const padded = row({ description: '  Parere legale.  ' });
    expect(fundCycleExpenseSchema.parse(padded).description).toBe('  Parere legale.  ');
  });

  /** Rule #3 / the migration's shape claim: this table names no member. */
  it('carries no member-identifying field', () => {
    const parsed = fundCycleExpenseSchema.parse(row());
    expect(Object.keys(parsed)).not.toContain('profile_id');
    expect(Object.keys(parsed)).toEqual([
      'id',
      'edition_id',
      'category',
      'amount_cents',
      'description',
      'incurred_on',
      'created_at',
      'updated_at',
    ]);
  });
});

describe('fundCycleExpenseInsertSchema', () => {
  const input = {
    edition_id: EDITION,
    category: 'legal_compliance' as const,
    amount_cents: 90000,
    description: '  Parere legale sulla raccolta pubblica.  ',
  };

  it('trims what the operator typed before it reaches a CHECK that forbids blanks', () => {
    expect(fundCycleExpenseInsertSchema.parse(input).description).toBe(
      'Parere legale sulla raccolta pubblica.',
    );
  });

  it('refuses a zero amount — a row that moves no total is noise in a transparency record', () => {
    expect(fundCycleExpenseInsertSchema.safeParse({ ...input, amount_cents: 0 }).success).toBe(
      false,
    );
  });

  it('allows a credit to be recorded', () => {
    expect(fundCycleExpenseInsertSchema.parse({ ...input, amount_cents: -2000 }).amount_cents).toBe(
      -2000,
    );
  });

  it('treats incurred_on as offerable, not required — the DB defaults it to today', () => {
    expect(fundCycleExpenseInsertSchema.parse(input).incurred_on).toBeUndefined();
    expect(
      fundCycleExpenseInsertSchema.parse({ ...input, incurred_on: '2026-01-31' }).incurred_on,
    ).toBe('2026-01-31');
  });

  it('offers no id, timestamps or edit surface — none of them is the operator’s to choose', () => {
    const parsed = fundCycleExpenseInsertSchema.parse(input);
    expect(Object.keys(parsed).sort()).toEqual([
      'amount_cents',
      'category',
      'description',
      'edition_id',
    ]);
  });

  it('refuses whitespace as a description after trimming', () => {
    expect(fundCycleExpenseInsertSchema.safeParse({ ...input, description: '   ' }).success).toBe(
      false,
    );
  });
});

describe('fundEditionExpenseTotalSchema', () => {
  const total = {
    edition_id: EDITION,
    category: 'payment_processing',
    total_cents: 10000,
    entry_count: 2,
  };

  it('accepts a published line of FUND-38’s «principali categorie di spesa»', () => {
    expect(fundEditionExpenseTotalSchema.parse(total)).toEqual(total);
  });

  /**
   * The generated types mark every view column nullable because Postgres cannot infer
   * non-nullability through a view. The grouping keys are NOT NULL and a group with
   * count(*) >= 1 cannot sum to null, so parsing is what turns that reasoning into a runtime
   * guarantee — a null here means the view changed shape, and it should fail loudly.
   */
  it('refuses the nulls the generated types allow but the view cannot produce', () => {
    expect(fundEditionExpenseTotalSchema.safeParse({ ...total, total_cents: null }).success).toBe(
      false,
    );
    expect(fundEditionExpenseTotalSchema.safeParse({ ...total, category: null }).success).toBe(
      false,
    );
    expect(fundEditionExpenseTotalSchema.safeParse({ ...total, edition_id: null }).success).toBe(
      false,
    );
  });

  it('accepts a negative total — a credit nets against the cost it corrects', () => {
    expect(fundEditionExpenseTotalSchema.parse({ ...total, total_cents: -500 }).total_cents).toBe(
      -500,
    );
  });

  it('refuses a negative entry_count — a count is not a signed figure', () => {
    expect(fundEditionExpenseTotalSchema.safeParse({ ...total, entry_count: -1 }).success).toBe(
      false,
    );
  });
});
