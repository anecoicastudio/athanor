/**
 * The donation stem (#789). The 2026-09-19 fund ruling keeps «donare / donazione» out of the
 * product and its texts — German and Italian public-collection rules — so a fund contribution is
 * never called a donation, in either locale.
 *
 * One definition, held by every copy surface's voice test: the catalogs (`i18n.test.ts`), the
 * legal pages (`apps/web/lib/legal-content.test.ts`), and, through a relative import, the auth
 * mail, the push templates and the Stripe Checkout line items (`supabase/functions`). A fix here
 * reaches all of them.
 *
 * A stem, not a word list: `dona` covers dona, donare, donazione, donato, donai; `doner` and `donò`
 * the future, conditional and passato remoto (donerà, donerebbe, donò); `dono`/`doni` the gift
 * noun and the present; `donor` the EN noun (donate/donation fall under `dona`). «donna»,
 * «dondolo» and EN «done» do not match. It is a prefix, so a proper noun can hit (Donati,
 * Donatella): give that one string a named exception at its test, never a looser stem.
 *
 * No imports: the Deno tests load this file directly.
 */
export const DONATION_STEM = /\bdon(?:a|er|ò|or|o\b|i)/i;
