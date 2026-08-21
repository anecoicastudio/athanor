/**
 * Structural stand-in for a Zod schema's `safeParse`. This package does not depend on `zod`
 * — it consumes `@athanor/schemas`' already-built schemas — so the helper below is typed by
 * shape rather than by importing `ZodTypeAny`, which would mean adding the dependency to get
 * one generic parameter.
 */
export type BoundaryParser<T> = {
  safeParse: (value: unknown) =>
    | { success: true; data: T }
    | {
        success: false;
        error: { issues: readonly { path: (string | number)[]; message: string }[] };
      };
};

/**
 * Parse a result set row by row: valid rows through, invalid rows withheld and counted.
 *
 * #421's shape, extracted once three readers needed it, and out of admin.ts once the public
 * index readers (#335) needed it too. Per-row `safeParse` rather than this package's usual
 * `.parse()`-and-throw, because the consequence differs: the single-entity boundaries feed a
 * content screen, while these feed lists — an operator's queue, a build's prerender set, the
 * sitemap. The realistic failure is the schema lagging the database — #392, which went five
 * actions and five migrations unnoticed — and on that failure a throw takes the whole list
 * down over one unrecognised row. Withholding keeps the surface up; returning `excluded`
 * keeps the omission honest, because silently dropping evidence is the other way to be wrong.
 *
 * `table` and `surface` only shape the warning; the caller says which reader spoke.
 */
export function parseOrWithhold<T>(
  rows: readonly unknown[] | null | undefined,
  parser: BoundaryParser<T>,
  table: string,
  surface: string,
): { parsed: T[]; excluded: number } {
  const parsed: T[] = [];
  let excluded = 0;
  for (const row of rows ?? []) {
    const result = parser.safeParse(row);
    if (result.success) {
      parsed.push(result.data);
      continue;
    }
    excluded += 1;
    // No logger exists in this package; a warning is the only channel that reaches
    // `wrangler tail` (and a build log), and the row id plus the failing path is what makes
    // the row findable. Never the row itself: the waitlist one carries an email.
    console.warn(
      `[api] ${table} row ${String((row as { id?: unknown }).id)} withheld from ${surface}: ${result.error.issues
        .map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`)
        .join('; ')}`,
    );
  }
  return { parsed, excluded };
}
