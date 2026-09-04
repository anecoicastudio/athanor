# Security policy

Athanor is a community platform whose central claim is that reputation (the **Aura** score) is
earned through real actions and cannot be bought. A large part of that claim is enforced in the
database and in the edge functions rather than in the UI, so a security report here is often also
a product report. Both are welcome.

## Reporting a vulnerability

**Use GitHub's private vulnerability reporting — not a public issue, not a pull request.**

→ [Report a vulnerability](https://github.com/anecoicastudio/athanor/security/advisories/new)
(repository **Security** tab → _Report a vulnerability_)

A public issue for a real vulnerability discloses it to everyone before there is a fix; this
repository is public, so please assume anything you write in an issue, a PR, or a commit message
is already read.

Please include what you would want to receive: the affected surface, the steps that reproduce it,
what an attacker gets out of it, and — if you found it against a live environment — which one.
A proof of concept helps more than a scanner label.

**What to expect.** Athanor is maintained by one person. Reports are triaged on a best-effort
basis, normally within a few days. There is no bug bounty and no payment; credit in the advisory
is offered unless you would rather stay anonymous.

**Please do not** run automated scanners, load tests, or brute-force attempts against the hosted
environments, access or modify data belonging to anyone else, or exfiltrate more data than is
needed to demonstrate the finding. Report it and stop.

## Supported surface

The project is pre-launch (Fase 1 MVP). There are no released versions and no backports: the
supported branch is **`main`**, and fixes land there.

| In scope                                                                   | Notes                                                                                                   |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `supabase/migrations` — RLS policies, grants, `SECURITY DEFINER` functions | Any read or write a client should not be able to perform                                                |
| `supabase/functions` — Deno edge functions                                 | Auth-posture bypass, missing `requireUser` / `requireServiceRole`, webhook signature or replay handling |
| `apps/native` — the Expo app                                               | Secret exposure in the bundle, auth/session handling, deep-link handling                                |
| `apps/web` — Next.js on Cloudflare Workers                                 | Authorization on the admin panel, SSR data leaks, the public `@handle` pages                            |
| `packages/*`                                                               | Validation bypass at a Zod boundary; anything that lets score state be forged                           |

Findings that let a client write `aura_events` / `aura_scores` directly, that let Aura be earned
by paying (Circle membership or fund contributions are worth **zero** points by design), or that
read another member's private content, are the highest-severity classes here.

### Out of scope

These are public by design, and a report about them will be closed:

- **`EXPO_PUBLIC_*` and `NEXT_PUBLIC_*` variables**, the Supabase **publishable / anon** key, and
  the Sentry DSN. They are shipped to clients deliberately; the anon key carries no privilege on
  its own, because RLS is what authorizes every row.
- **Supabase project refs** (`kwzeiqvrnnaagccyoose`, `eralyiwkfrpqsawivegz`). Identifiers, not
  credentials.
- **Fixtures and seeds** — placeholder keys in pgTAP tests, `*.env.example` files and
  `supabase/staging-seed/`. They are non-functional strings.
- **The staging environment's contents.** Staging is populated with fabricated people and
  fabricated posts and is reseeded from `supabase/staging-seed/`; nothing in it is anyone's
  real data.
- Missing hardening headers, version-disclosure banners, and similar findings with no
  demonstrated impact.

## What is enforced, and where

Security invariants here are code, not convention, and the tests are the specification:

- **Aura is never client-writable.** RLS denies every client write to `aura_events` /
  `aura_scores`; only the service-role `score-engine` function writes them. pgTAP asserts the
  denial, so the rule fails loudly rather than silently.
- **RLS on every table**, deny-by-default, with an explicit `grant` of only the verbs the policies
  mediate. Privileges are asserted directly, not inferred from a write that happens to fail.
- **Edge functions are the only privileged surface.** Each declares exactly one auth posture and a
  test asserts the whole table, so a function cannot land with the wrong one.
- **Stripe is the source of truth for money.** Webhooks are signature-verified and deduped;
  Stripe secret keys exist only server-side and never in the app.
- **Secrets never enter the repository.** Env files are gitignored, secrets live in edge-function
  environment and in Vault, and a CI job exports the mobile bundle and greps it for secret
  material on every pull request.

If you find a case where one of these is claimed but not actually enforced, that is a valid
report even without a full exploit.
