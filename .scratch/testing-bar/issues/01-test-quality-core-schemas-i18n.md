# Test quality core schemas i18n

Type: research
Status: open

## Question

Do `packages/core`, `packages/schemas`, and `packages/i18n` actually practise TDD, or do they
merely hit their 90% thresholds?

All three enforce 90% lines/branches/functions/statements and carry near-1:1 test-to-source
ratios (core 32 tests / 33 src, schemas 41/42, i18n 1/2). High coverage is not evidence of TDD.

Determine:
- Are the tests behavioural (assert domain rules) or structural (assert implementation shape)?
- Is `.claude/rules/core.md`'s mandated assertion present — that Circle membership and fund
  contributions yield **zero** score points?
- Are score weights asserted against the single named-constants module, per rule 10?
- Is the no-inline-`Date.now()`/`Math.random()` injection rule actually honoured, or worked around?
- Any test that would still pass if the implementation were deleted and stubbed?
