# Tdd forward or retroactive

Type: grilling
Status: open
Blocked by: 07

## Question

Is TDD forward-only from here, or does existing code get backfilled to the bar?

`.claude/rules/core.md` already mandates TDD for `packages/core`. The question is what that means
for the ~213 untested files in `apps/native` and the 20%-floor in `packages/api`: backfill to the
bar, freeze the bar and only apply it to new code, or ratchet on touch.

Settle the policy and where it is written down so it binds future sessions.
