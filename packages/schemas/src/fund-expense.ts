import { z } from 'zod';
import { nonBlankString, trimmedNonBlank } from './primitives.ts';

/**
 * The published expense vocabulary (#234, FUND-29) — doc §20 «principali categorie di spesa;
 * eventuali compensi o costi di gestione previsti», PRD.md:256.
 *
 * This array and the `fund_cycle_expenses_category_check` CHECK are the same list, and the
 * CHECK is the authority: the database refuses a value that is not here, so a drift shows up
 * as a 23514 rather than as a category the public page cannot render. Widening it means a new
 * migration (drop and re-add the constraint, the `closure_reason` pattern) and this array in
 * the same commit.
 *
 * `other` is last and is deliberate. A cost that fits nothing above is either mis-filed under
 * a category that does not describe it or left unrecorded, and both are worse for a
 * transparency record than a named residual — under `other`, `description` is the entire
 * account of the money.
 */
export const FUND_EXPENSE_CATEGORIES = [
  'payment_processing',
  'payout_transfer',
  'platform_operations',
  'legal_compliance',
  'management_fee',
  'other',
] as const;

export const fundExpenseCategorySchema = z.enum(FUND_EXPENSE_CATEGORIES);
export type FundExpenseCategory = z.infer<typeof fundExpenseCategorySchema>;

/** The description bound, mirroring `fund_cycle_expenses_description_check` exactly. */
const DESCRIPTION_MAX = 500;
const DESCRIPTION_REQUIRED = 'a cost has to say what it was';

/**
 * One recorded cost (#234, FUND-29) — what the cycle actually spent, against #232's frozen
 * declaration of what it intended to.
 *
 * `amount_cents` is SIGNED and that is the design: a published cost is never edited into a
 * different past, so an overstatement is corrected by recording the credit as its own
 * negative row in the same cycle and category. The published figure is the per-category sum
 * (`fundEditionExpenseTotalSchema`), which comes out right while both facts stay visible.
 * Zero is refused by the CHECK — a row that moves no total is noise in a transparency record.
 *
 * No `profile_id`, and nothing that could become one: this is Athanor's own bookkeeping, not
 * member data, which is why the table sits outside the GDPR export sweep rather than inside
 * it as an exclusion. The fee coverage a contributor chose to add is NOT here either — that
 * is members' money (`fund_contributions.coverage_cents`), and netting it against a cost
 * would destroy the gross figure §20 asks to publish.
 */
export const fundCycleExpenseSchema = z.object({
  id: z.string().uuid(),
  edition_id: z.string().uuid(), // the cycle — the grouping every published figure uses
  category: fundExpenseCategorySchema,
  amount_cents: z.number().int(), // signed; the DB refuses 0
  description: nonBlankString(DESCRIPTION_MAX, DESCRIPTION_REQUIRED),
  // The day the money went, which is not the day it was typed: an operator records January's
  // processing fees in March, and `created_at` would date them to March.
  incurred_on: z.string(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type FundCycleExpenseRow = z.infer<typeof fundCycleExpenseSchema>;

/**
 * What an operator records. Written today as service-role SQL — no client may insert, in
 * either the policy sense or the grant sense — so this exists as the single place the bounds
 * live rather than as a shape some app already posts. Whoever builds the recording surface
 * gets the CHECK's rules without re-deriving them from the migration.
 *
 * There is no edit schema on purpose. A published cost is corrected by recording a credit,
 * not by rewriting the row that was already published.
 */
export const fundCycleExpenseInsertSchema = fundCycleExpenseSchema
  .pick({
    edition_id: true,
    category: true,
  })
  .extend({
    // Write-side trimming, read-side validation only — the column's CHECK forbids a blank,
    // so client input is normalized before it can be refused for whitespace.
    description: trimmedNonBlank(DESCRIPTION_MAX, DESCRIPTION_REQUIRED),
    amount_cents: z
      .number()
      .int()
      .refine((v) => v !== 0, 'a cost of zero moves no total'),
    // Defaulted in the database to the day it is recorded, which is right for a cost entered
    // as it lands and wrong for one entered from an old invoice — so it is offerable, and
    // omitting it is not an error.
    incurred_on: z.string().optional(),
  });
export type FundCycleExpenseInsert = z.infer<typeof fundCycleExpenseInsertSchema>;

/**
 * One published line of FUND-38's «principali categorie di spesa» — one cycle, one category,
 * summed (`public.fund_edition_expense_totals`).
 *
 * Every column is non-null here even though the generated types mark them nullable: Postgres
 * cannot infer non-nullability through a view, but the grouping keys are NOT NULL columns and
 * a group with `count(*) >= 1` cannot sum to null. Parsing with this schema is what turns
 * that reasoning into a runtime guarantee rather than a cast.
 *
 * `total_cents` is signed for the same reason `amount_cents` is — it is the figure a credit
 * row nets into. A category with no rows is absent rather than zero: the report renders what
 * was spent, not a checklist of what was not.
 */
export const fundEditionExpenseTotalSchema = z.object({
  edition_id: z.string().uuid(),
  category: fundExpenseCategorySchema,
  total_cents: z.number().int(),
  entry_count: z.number().int().nonnegative(),
});
export type FundEditionExpenseTotal = z.infer<typeof fundEditionExpenseTotalSchema>;
