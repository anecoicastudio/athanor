# Athanor

Community platform where reputation (the **Aura** score) is earned only through real, verifiable actions — never bought. This is the **canonical working repo**: the Expo mobile app, the web app (marketing site + admin moderation panel) and the full Supabase backend (migrations, RLS policies, pgTAP tests, edge functions), plus the four reference documents in `docs/` that this repo's source comments cite. The remaining product docs are internal and not published here.

## Stack

TypeScript strict everywhere · Zod at every boundary · Turborepo + pnpm · Expo SDK 54 + expo-router + NativeWind v5 · Supabase (Postgres + RLS, Auth, Realtime, Storage, Deno edge functions) · Stripe (Checkout, Billing, Identity) · Vitest + pgTAP + Deno tests.

## Repository map

| Path               | What lives there                                                                           |
| ------------------ | ------------------------------------------------------------------------------------------ |
| `apps/native`      | Expo app — **the product**. Screens under `src/app/`, tabs in `src/app/(tabs)/`            |
| `apps/web`         | Next.js 16 — marketing site, public `@handle` profiles, waitlist, **admin panel**          |
| `packages/core`    | Pure domain logic (score engine, badges, matching). **No I/O**                             |
| `packages/api`     | Typed Supabase client + queries. **No business logic**                                     |
| `packages/schemas` | Zod schemas — the single validation source                                                 |
| `packages/i18n`    | IT/EN catalogues                                                                           |
| `packages/config`  | Design tokens, tsconfig presets                                                            |
| `supabase/`        | Migrations, RLS policies, pgTAP tests, Deno edge functions (outside the pnpm workspace)    |
| `docs/`            | Four reference documents — see below. The rest of `docs/` is internal and not in this repo |

Dependency rule: `apps → packages` only; `core` imports only `schemas`.

### The four documents in `docs/`

Source comments across this repo cite these by section number (`PRD §4.11`, `RELEASE-RUNBOOK §6`,
`PRODUCTION-READINESS P5`), so they are tracked and you can open them:

| File                           | Read it when                                                                                                               |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| `docs/PRD.md`                  | You need the product requirement behind a feature — scope, data model, key flows, milestone order                          |
| `docs/DESIGN.md`               | **Before any visual or UI decision.** Layout, type scale, components, colour and logo usage. Do not deviate without asking |
| `docs/RELEASE-RUNBOOK.md`      | You are touching release, deploy, feature flags or store submission                                                        |
| `docs/PRODUCTION-READINESS.md` | You hit a `PARKED(...)` comment and want to know why something is unbuilt                                                  |

These four sometimes cite **other** documents in `docs/` — `FUND-SPEC.md`, `MILESTONES.md`,
`FRONTEND.md` and a few more — which are internal and deliberately not in this repo. A pointer you
cannot follow is not a broken link; ask, and the relevant part will be moved into an issue or into
this README. Anything you actually need to do your work belongs in one of those two places.

Migrations are append-only, so a comment in one can never be corrected in place. Where the
prose has turned out to be wrong, the correction is in **`supabase/MIGRATIONS-ERRATA.md`** —
read it before trusting a migration's comments. The pgTAP tests are the source of truth.

## First hour

```bash
pnpm install
pnpm typecheck && pnpm lint && pnpm test    # must be green before touching anything
cd apps/native && pnpm exec expo start      # run the app in Expo Go
pnpm --filter web dev                       # web app on :3000 (copy apps/web/.env.example → .env.local first)
```

**Point the app at staging**, not at a local database: put the staging Supabase URL +
publishable key (provided at onboarding) in `apps/native/.env`. `EXPO_PUBLIC_*` variables
only — a service-role key must never appear in this repo or the app.

`pnpm gen:types` reads the **staging** project rather than a local stack, so it needs
`supabase login` once (or a `SUPABASE_ACCESS_TOKEN`) plus membership of the org that owns
the project — without those it fails on the Management API, not on Docker. Set
`SUPABASE_TYPES_PROJECT_ID` to regenerate from a different project.

A **local Postgres is optional** and no longer part of the default loop:

```bash
supabase start && supabase db reset         # full schema + seed — needs Docker and ~6 GB
supabase test db                            # pgTAP suite (81 files, 964 assertions)
```

What you give up by skipping it is mostly speed: the `db` CI job spins up its own stack and
runs the whole suite there, so a failure surfaces ~3 minutes later instead of immediately.
⚠️ One real gap — CI runs on pushes to `dev`/`main` and on pull requests, **not** on a push
to a `feat/*` branch with no PR open yet. During pre-PR iteration there is no safety net at
all, which is exactly when RLS gets broken. Open the PR early, or keep a local stack.

## Git workflow

```
feat|fix|chore|docs/*  --PR-->  dev  --release PR-->  main
       (work)                (integration            (release =
                              = staging)              production)
```

1. Every change starts on a `feat/*`, `fix/*`, `chore/*` or `docs/*` branch and reaches `dev` **only through a pull request** — CI green (lint, typecheck, unit tests, formatting, i18n parity, web e2e, edge tests, pgTAP + types-in-sync when you touch `supabase/**`, `packages/schemas/**` or `database.types.ts`, and a mutation score when you touch `packages/core` or `packages/schemas`) + review. No direct pushes to `dev` or `main`.
   - One exception — to the one-branch-per-change rule, **never** to the pull request: a **batched `chore/*` sweep** may share **one branch and one PR** across several changes that alter no runtime behaviour and touch no migration, schema, RLS policy, i18n catalog, or dependency — one commit per change, so the sweep can still be reverted piecewise. Anything that changes behaviour leaves the sweep and takes its own branch.
2. **Work you find beyond the issue stays in the same PR.** Implementing an issue routinely surfaces fixes it never asked for — whoever wrote the issue could not see every detail the implementation exposes. Fix them on the same branch and list them in the PR body under a `## Beyond the issue` heading. That is not scope creep, and reviewers will not treat it as such; what gets flagged is an extra that is **not** listed.
3. `dev` mirrors **staging**; `dev → main` is a release PR, merged only by the maintainer after the go/no-go. Store builds and production migrations come from `main`.
4. **Hotfix:** `fix/*` from `main`, PR to `main`, back-merge to `dev`.
5. Commit style as in the history: `feat(mobile): …`, `fix(db): …` — short imperative subject.

| Environment | Branch   | Supabase project             | Stripe    | Access                |
| ----------- | -------- | ---------------------------- | --------- | --------------------- |
| Local       | `feat/*` | staging (Docker is optional) | test mode | each dev, own machine |
| **Staging** | `dev`    | `athanor-staging`            | test mode | team                  |
| Production  | `main`   | `athanor`                    | live      | **maintainer only**   |

Migrations reach a hosted project only through `supabase db push`, staging first and
production at release — CI pushes to neither. `supabase/.temp/linked-project.json` decides
which one you are pushing to, so check it before every push.

## The ten non-negotiable rules

Enforced by CI and review on every PR — not style preferences.

1. **Aura is never client-writable.** Only the `score-engine` edge function (service role) writes `aura_events` / `aura_scores`. RLS denies all client writes; pgTAP asserts it. Circle membership and fund contributions yield **zero** points.
2. **RLS on every table**, deny-by-default, policies in the wrapped form `(select auth.uid())`, always `TO authenticated` / `TO anon` plus an ownership predicate. UPDATE policies need both `USING` and `WITH CHECK`.
3. **No vanity metrics** rendered publicly — reaction counts are visible to the author only.
4. **Design tokens only** — no literal hex in app code; tokens come from `@athanor/config`.
5. **Zero hardcoded user-facing strings** — everything through `@athanor/i18n`, IT **and** EN (a parity test fails the build otherwise).
6. **Money state is a cache of Stripe webhooks.** Stripe is the source of truth; keys server-side only; webhooks signature-verified and deduped.
7. **Migrations are append-only once applied.** Create new ones via `supabase migration new <name>`, then `pnpm gen:types`. Never hand-edit `packages/api/src/database.types.ts`.
8. **Cursor pagination, never offset.**
9. **Score weights** are named constants in one `packages/core` module — server-tunable, test-asserted.
10. **Never commit secrets.** Env files are gitignored; CI greps the built bundle for leaked keys as a release gate.

## Working conventions

- **Native dependencies:** `pnpm exec expo install`, never `pnpm add`; then `pnpm exec expo-doctor`. The project is on **Expo SDK 54** (deliberate) — check the SDK 54 docs, not the latest.
- **Styling:** NativeWind classNames through the wrappers in `src/tw` — plain RN components don't accept `className` here.
- **The app pnpm package is named `native`, unscoped** — `--filter @athanor/native` is a silent no-op; use `--filter native`.
- **Environments:** production is maintainer-only; staging is the shared workbench, seeded with fake data — never put real people's content in it. Enable MFA on your GitHub and Supabase accounts.
