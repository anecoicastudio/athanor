# Pgtap rls coverage

Type: research
Status: open

## Question

Do the 71 pgTAP tests cover every table, or just the ones someone remembered?

`supabase/tests/` holds 71 `.sql` files, numbered and named per table. `.claude/rules/supabase.md`
requires a pgTAP test in the same change as every new table.

Determine:
- Enumerate every table created across `supabase/migrations/`, and diff that inventory against
  the tables asserted in `supabase/tests/`. Name any table with no test.
- Is the Aura invariant asserted — RLS denying **all** client writes to `aura_events` and
  `aura_scores`, service role only (rule 1)?
- Do the tests assert the *policy form* the rules require: `TO authenticated`/`TO anon`, the
  wrapped `(select auth.uid())` predicate, `USING` **and** `WITH CHECK` on UPDATE?
- Is deny-by-default actually tested — i.e. does any test assert a negative (a user who must
  *not* see a row), or do they only assert the happy path?
- Any `SECURITY DEFINER` function without a locked `search_path` or without revoked execute?
