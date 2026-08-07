# Athanor — mobile app

Community platform where reputation (the **Aura** score) is earned only through real, verifiable actions — never bought. This is the **partner working repo**: the Expo mobile app plus its full Supabase backend (migrations, RLS policies, pgTAP tests, edge functions). The marketing site, the admin panel and the internal product docs live in the upstream repo.

## Stack

TypeScript strict everywhere · Zod at every boundary · Turborepo + pnpm · Expo SDK 54 + expo-router + NativeWind v5 · Supabase (Postgres + RLS, Auth, Realtime, Storage, Deno edge functions) · Stripe (Checkout, Billing, Identity) · Vitest + pgTAP + Deno tests.

## Repository map

| Path               | What lives there                                                                        |
| ------------------ | --------------------------------------------------------------------------------------- |
| `apps/mobile`      | Expo app — **the product**. Screens under `src/app/`, tabs in `src/app/(tabs)/`         |
| `packages/core`    | Pure domain logic (score engine, badges, matching). **No I/O**                          |
| `packages/api`     | Typed Supabase client + queries. **No business logic**                                  |
| `packages/schemas` | Zod schemas — the single validation source                                              |
| `packages/i18n`    | IT/EN catalogues                                                                        |
| `packages/config`  | Design tokens, tsconfig presets                                                         |
| `supabase/`        | Migrations, RLS policies, pgTAP tests, Deno edge functions (outside the pnpm workspace) |

Dependency rule: `apps → packages` only; `core` imports only `schemas`.

## First hour

```bash
pnpm install
pnpm typecheck && pnpm lint && pnpm test    # must be green before touching anything
supabase start && supabase db reset         # local Postgres, full schema + seed (Docker required)
supabase test db                            # pgTAP suite
cd apps/mobile && npx expo start            # run the app in Expo Go (local backend)
```

To run against **staging**, point `apps/mobile/.env` at the staging Supabase URL + publishable key (provided at onboarding). `EXPO_PUBLIC_*` variables only — a service-role key must never appear in this repo or the app.

## Git workflow

```
feat|fix|chore/*  --PR-->  dev  --release PR-->  main
     (work)              (integration            (release =
                          = staging)              production)
```

1. Every change starts on a `feat/*`, `fix/*` or `chore/*` branch and reaches `dev` **only through a pull request** — CI green (lint, typecheck, unit tests, pgTAP, edge tests) + review. No direct pushes to `dev` or `main`.
2. `dev` mirrors **staging**; `dev → main` is a release PR, merged only by the maintainer after the go/no-go. Store builds and production migrations come from `main`.
3. **Hotfix:** `fix/*` from `main`, PR to `main`, back-merge to `dev`.
4. Commit style as in the history: `feat(mobile): …`, `fix(db): …` — short imperative subject.

| Environment | Branch   | Supabase project | Stripe    | Access                |
| ----------- | -------- | ---------------- | --------- | --------------------- |
| Local       | `feat/*` | local (Docker)   | —         | each dev, own machine |
| **Staging** | `dev`    | staging          | test mode | team                  |
| Production  | `main`   | production       | live      | **maintainer only**   |

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

- **Native dependencies:** `npx expo install`, never `pnpm add`; then `npx expo-doctor`. The project is on **Expo SDK 54** (deliberate) — check the SDK 54 docs, not the latest.
- **Styling:** NativeWind classNames through the wrappers in `src/tw` — plain RN components don't accept `className` here.
- **The mobile pnpm package is named `mobile`, unscoped** — `--filter @athanor/mobile` is a silent no-op.
- **Environments:** production is maintainer-only; staging is the shared workbench, seeded with fake data — never put real people's content in it. Enable MFA on your GitHub and Supabase accounts.
