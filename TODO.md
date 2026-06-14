# Athanor — PRD Build Order

Single source for **what to build next**. Milestone order is binding (`docs/PRD.md` §11). Each milestone pairs a **frontend** PRD with its **backend** doc(s); migrations ship in milestone order even though the backend suite is organized by subsystem.

- **Frontend suite:** `docs/superpowers/specs/2026-06-13-frontend-prd/`
- **Backend suite:** `docs/superpowers/specs/2026-06-13-backend-prd/`
- **Contract matrix:** `docs/superpowers/specs/2026-06-13-CONTRACT-MATRIX.md`

Legend: `[x]` done · `[~]` partial · `[ ]` not started

---

## ▶ M0.5 — Design-system reconciliation gate (DO FIRST)

Blocking prerequisite. Governance edits only, **no app code**. Until closed, the literal-hex hook + `athanor-reviewer` enforce the OLD rules and will falsely flag legit M1+ code. Spec: frontend `00-foundation.md` §1.1 + `README.md` migration table.

- [ ] `CLAUDE.md` rule #4 → cyan = action + meaning (glow reserved for moment-grade events)
- [ ] `docs/DESIGN.md` → bg `#000206`→`#0A0A1A` (+ radial wash); Hanken `400/600`→`300–800`; adopt 20-glyph esoteric icon set (retire "vesica-only/no mysticism", mandorla stays logo); drop Instrument Serif (dream register = Hanken italic)
- [ ] `packages/config` tokens + `app.json` `backgroundColor` + splash
- [ ] `.claude/settings.json` literal-hex warning scope loosened
- [ ] `.claude/agents/athanor-reviewer` accent policy updated
- [ ] Gate verified at launch (`10-m10-launch.md` §1.1)

---

## Milestones (PRD §11 order)

| #   | Milestone       | Frontend PRD          | Backend doc(s)                                                                                  | Status |
| --- | --------------- | --------------------- | ----------------------------------------------------------------------------------------------- | ------ |
| M0  | Foundation      | `00-foundation.md`    | `00-foundation` (db conventions, `remote_config`, `stripe_webhook_events`) · `01-auth-identity` | `[~]`  |
| M1  | Identity        | `01-m1-identity.md`   | `02-schema-profiles-sogno` (profiles/dreams) · storage (`10`)                                   | `[~]`  |
| M2  | Il Sogno        | `02-m2-sogno.md`      | `02-schema-profiles-sogno` (milestones/helps/favors/invites) · `07` (help award)                | `[ ]`  |
| M3  | Community       | `03-m3-community.md`  | `03-schema-community` · `09-realtime-push` · `07` (✦ award)                                     | `[ ]`  |
| M4  | Athanor Live      | `04-m4-live.md`       | `04-schema-events` · `08-payments-stripe` (tickets)                                             | `[ ]`  |
| M5  | Momenti         | `05-m5-momenti.md`    | `05-schema-momenti` · `11-edge-functions` (matcher) · `09` (push) · `07` (msg award)            | `[ ]`  |
| M6  | Aura            | `06-m6-aura.md`       | `07-score-engine` (engine, weights, decay, stars, tiers)                                        | `[ ]`  |
| M7  | Il Cuore (Fund) | `07-m7-cuore-fund.md` | `06-schema-fund-circle-trust` (fund) · `08-payments-stripe` (contributions)                     | `[ ]`  |
| M8  | Athanor Circle    | `08-m8-circle.md`     | `06` (memberships/entitlements) · `08-payments-stripe` (Billing) · `13-search`                  | `[ ]`  |
| M9  | Trust           | `09-m9-trust.md`      | `06` (reports/blocks/notifications/consent/gdpr) · `08` (Identity) · `01` (roles)               | `[ ]`  |
| M10 | Launch          | `10-m10-launch.md`    | `10-security-rls-gdpr` · `08` (IAP) — release gates                                             | `[ ]`  |

### Cross-cutting (inherited by every milestone — not standalone milestones)

- [ ] `12-platform-resilience.md` (frontend) — offline-first queue+sync, app/session/account lifecycle, permissions priming, EXIF/GPS strip, crash-only telemetry (Sentry, no ATT), force-update/maintenance, error/skeleton system, haptics, safe-area
- [ ] `10-security-rls-gdpr.md` (backend) — RLS pattern library, invariant pgTAP, storage RLS, GDPR, CI strategy
- [ ] `10-m10-launch.md` (frontend) — i18n audit (reconciles namespace drift), WCAG pass, beta, store submission

### Fase 2 (parked — out of Fase 1 scope)

- [ ] `11-fase2-beyond.md` (frontend) / `12-fase2-beyond.md` (backend) — Marketplace, Athanor Academy, Local Circles, Athanor Stories, Tempo Bank economy, Connect

---

## Already built (do NOT re-spec — backend suite README)

Backend **M0 + M1 shipped**:

- `public.profiles` (1:1 `auth.users`, RLS, touch trigger, `handle_new_user`)
- `public.dreams` (one-active partial unique index, RLS owner-write)
- 4 migrations · 2 pgTAP suites (`profiles_rls`, `dreams_rls`)
- `@athanor/api`: `profiles.ts`, `dreams.ts`, generated `database.types.ts`
- `@athanor/schemas`: `profile.ts`, `dream.ts`, `onboarding.ts`
- `@athanor/core`: `onboarding/*`, `profile/completeness.ts`, `score/clamp.ts`, `onboarding/tags.ts` — **no score engine / weights.ts / matcher yet**
- Auth: OTP magic-link (6-digit, 3600s), IT template, signup enabled — OAuth providers pending

> ⚠ Frontend M0/M1 marked `[~]`: M1 onboarding shipped to `main` earlier, but the new frontend suite **restores all 5 tabs** (supersedes the 2-tab mobile-first trim) and adopts the prototype design system — foundation + M1 screens need rebuild/reconcile against this suite after M0.5.

---

## Next action

1. Close **M0.5** governance gate.
2. Build/reconcile **M0 Foundation** (frontend `00` + backend `00`/`01`).
3. Build/reconcile **M1 Identity** (frontend `01` + backend `02` deltas + storage).
