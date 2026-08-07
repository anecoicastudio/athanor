# The gate

Type: grilling
Status: open
Blocked by: 07

## Question

What mechanism enforces the bar, and what stops it being lowered?

Today the enforcement is vitest `thresholds` per package plus a Stop hook running
`typecheck`+`lint`. `packages/api` shows the failure mode: thresholds can be *set to* whatever the
suite currently achieves, which makes them a record rather than a constraint.

Settle: what runs in CI, whether the ratchet is mechanical or a review convention, and what a
session must do when it cannot meet the bar — block, or record an exception where?
