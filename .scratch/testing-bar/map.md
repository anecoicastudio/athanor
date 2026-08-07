# Map: The testing bar for Athanor

Label: wayfinder:map

## Destination

A **decided testing bar for every surface of Athanor** — core/schemas/i18n, api, apps/native,
edge functions, pgTAP/RLS, Stripe money paths — together with the ledger of where today's code
falls short of it, sharp enough to hand to an executing session as a remediation plan.

The destination is the *decision plus the gap ledger*. Writing the missing tests is past it.

> **Assumption flag.** The destination was named from the invoking prompt, not from a grilling
> session — the human was AFK when this map was charted. Redraw it if it points the wrong way.

## Notes

- Domain: Athanor — RN/Expo + Supabase (Postgres/RLS/Deno edge) + Stripe. See `CLAUDE.md`,
  `docs/PRD.md`, `.claude/rules/*.md`.
- Skills every session should consult: `/grilling`, `/domain-modeling`, `/tdd`, `/research`.
- Standing constraint: `.claude/rules/core.md` forbids lowering the 90% thresholds in
  `packages/core`. `packages/api` records a deliberate floor with a ratchet-up-only comment —
  treat that as precedent, not licence.
- Prior art: branch `chore/audit-tier23` is a Tier-2/3 audit already in flight (8 commits,
  2026-08-07). Its work was mostly *making code testable* (extract `logic.ts` from edge shells,
  split fat mobile routes, shared pagination helpers) plus security fixes. This map continues
  that effort — it does not restart it.

## Decisions so far

<!-- one line per resolved ticket -->

_None yet — map charted 2026-08-07._

## Not yet specified

- **Remediation sequencing.** What gets fixed first, and whether it is one branch or several.
  Cannot be sharpened until the gap ledger exists (tickets 01–06).
- **Mobile test strategy shape.** Whether `apps/native` wants unit tests via RN Testing Library,
  end-to-end via Maestro/Detox, or both at different bars. Hangs on ticket 03's finding about
  what is testable without new harness work.
- **Whether `packages/config` warrants tests at all.** 2 source files, 0 tests, no vitest config;
  design tokens may be adequately covered by typecheck. May fold into ticket 07 rather than
  becoming its own ticket.
- **Coverage as a proxy.** Whether line coverage is the right bar at all, or whether the money
  and Aura paths deserve a stronger signal (mutation testing, property tests). Hangs on 02/06.

## Out of scope

- Writing the missing tests. This map decides the bar and measures the gap; execution is a
  separate effort.
- Changing product code to raise coverage, beyond noting where untestable structure is the
  blocker.
- M10 launch release ops (`docs/RELEASE-RUNBOOK.md`) — a live, separate effort.
