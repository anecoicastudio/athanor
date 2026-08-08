# Environment reference — knowledge behind the `.env.example` files

Long-form notes relocated from the `.env.example` headers so those stay scannable.
Nothing here is a secret; everything here has bitten (or nearly bitten) once.

## Platform-injected `SUPABASE_*` variables (edge functions)

`supabase secrets set` rejects the `SUPABASE_` prefix — the platform injects these into
every deployed function automatically:

- `SUPABASE_URL` · `SUPABASE_DB_URL` · `SUPABASE_JWKS`
- `SUPABASE_PUBLISHABLE_KEYS` · `SUPABASE_SECRET_KEYS` — **name-keyed JSON objects**, not
  plain strings
- `SUPABASE_ANON_KEY` · `SUPABASE_SERVICE_ROLE_KEY` — legacy, deprecated end-2026

Functions read keys **only** through `functions/_shared/keys.ts`
(`publishableKey()` / `secretKey()` / `secretKeys()`), never `Deno.env.get` directly: the
new variables are JSON dictionaries and the legacy ones die the moment "Disable legacy
API keys" is clicked. For `supabase functions serve` locally, use the values
`supabase status` prints — the local stack issues its own `sb_publishable_`/`sb_secret_`
pair. Keep those local values in `supabase/.env.local` (separately gitignored).

## Stripe reference (sandbox, DE / EUR)

Public identifiers, not secrets:

| What                              | Id                                                                                                                                               |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Account                           | `acct_1U23HsQ27ZDmslJ8`                                                                                                                          |
| Webhook destination (live config) | `we_1U257CQ27ZDmslJ8unxgUdUC` — API version `2026-05-27.dahlia`, 10 events                                                                       |
| Old webhook destination           | `we_1U23QwQ27ZDmslJ8EqF5ZvjO` — 2020-08-27, 3 PaymentIntent events the code never handled; disable once the new one is live                      |
| Payment-method configuration      | `pmc_1U23I2Q27ZDmslJ8WsNgBSei`                                                                                                                   |
| Circle product                    | `prod_V29QBE8aw9OdcL` (prices in `supabase/.env.example`; €12/€99 copy lives in `packages/i18n` keys `circle.cta.monthly` / `circle.cta.annual`) |

**The delayed-settlement trap.** No code pins `payment_method_types`, so the
payment-method configuration is the _sole_ control over which rails reach Checkout. The
webhook deliberately supports only immediate-notification methods (card + wallets, Link,
PayPal, Bancontact, EPS…): enabling a delayed rail (SEPA, ACH, Bacs, BECS, ACSS, Pay by
Bank, BLIK, vouchers, bank transfers) makes `stripe-webhook` 500 **by design** — see
`assertSettled` in `functions/stripe-webhook/handlers.ts`, and the two
`async_payment_*` events are not subscribed. PayPal is synchronous by default — that is
why it is safe; never ask Stripe Support to switch it.

**No `STRIPE_API_VERSION` env var.** The version is a code constant
(`functions/_shared/stripe.ts` — `2026-05-27.dahlia`) and the webhook endpoint must be
created at that same version. Splitting it across code and env is how payload shapes
drift.

## Why the mobile app has no Stripe / payment variables

Every payment flow opens a hosted Stripe URL minted by an edge function
(`create-ticket-checkout` / `-contribution-session` / `-circle-checkout` /
`-circle-portal` / `-verification-session`). The app never holds any Stripe key, and
`@stripe/stripe-react-native` is deliberately NOT a dependency (native module — would
break App Store Expo Go). None of these exist, and adding them would be dead weight that
Metro inlines into the shipped bundle:

`EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY` (no client SDK to hand it to) ·
`EXPO_PUBLIC_STRIPE_RETURN_URL` (return URLs built server-side from `APP_DEEPLINK_BASE`)
· `EXPO_PUBLIC_APP_SCHEME` (declared once, in `app.json` "scheme") ·
`EXPO_PUBLIC_APPLE_MERCHANT_ID` / `EXPO_PUBLIC_GOOGLE_PAY_TEST_ENV` (need the native SDK)
· `EXPO_PUBLIC_MERCHANT_COUNTRY` (Checkout takes it from the Stripe account) ·
`EXPO_PUBLIC_DEFAULT_CURRENCY` (priced server-side per session; `eur` throughout).

## Future authenticated e2e (web admin)

When authenticated admin flows land in Playwright, test seeding (admin user, session
minting) uses the `sb_secret_…` key via CI secrets or a server-side helper **only** —
never an env file the Next process can read, never anything prefixed `NEXT_PUBLIC_`.

## Postgres GUCs

`app.settings.*` values are operator commands against the database
(`alter database postgres set "app.settings.*"`), never set via env files and never in a
migration — a secret in a migration is committed to git and, under rule #7 (append-only
migrations), unrotatable. See `docs/PRODUCTION-READINESS.md`.
