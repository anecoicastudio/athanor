# Api coverage floor

Type: research
Status: open

## Question

What is `packages/api` not testing, and why did its coverage floor land at 20% lines?

`packages/api/vitest.config.ts` sets `lines: 20, statements: 20, functions: 40, branches: 75` —
explicitly "the floor of what the suite covered that day (2026-08-07)", with a ratchet-up-only
comment targeting 90%. 25 test files against 42 source files.

Determine:
- Which modules carry zero or near-zero coverage, named individually.
- Is the untested surface thin plumbing (generated-type passthrough) or real logic that
  `.claude/rules/api.md` says should not live here at all?
- Are the rule-mandated behaviours tested: cursor pagination never offset (rule 9), realtime
  subscriptions returning cleanup functions, queryKey factories per entity?
- Why is `branches` at 75 while `lines` is at 20 — what shape of suite produces that gap?
- What is the smallest set of tests that would move the floor most?
