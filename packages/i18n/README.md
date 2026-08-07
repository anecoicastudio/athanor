# @athanor/i18n

IT/EN message catalogs (flat dot-namespaced keys) + `t(key, locale, vars?)`.

## Invariants (enforced)

- **IT is canonical; EN mirrors every key** — `i18n.test.ts` `catalog parity`.
- **Interpolation parity (I-4)** — `{var}` placeholder set matches IT↔EN per key (`catalog quality`).
- **Athanor voice (I-3)** — no `engagement` / `utenti` / singular-vanity `notifica` in values (`catalog quality`). «Notifiche» (plural feature title) is allowed.
- **No hardcoded strings (I-2)** — `pnpm i18n:check` scans `apps/native/src`; CI gate. Allowlist a line with `// i18n-ignore`.

## Locale (I-6)

Resolved at runtime from `profiles.locale` (persisted on the Settings → Lingua switch, M1 B11), falling back to the device locale (`apps/native/src/lib/locale.ts`) for pre-profile surfaces (auth, BrandSplash). Live switch + restart persistence verified on device.

## RTL — out of scope (I-9)

Athanor Fase 1 ships **IT + EN only**, both LTR. No RTL layout work; the app does **not** force LTR globally, so a future RTL locale isn't blocked at the layout layer — but RTL mirroring is **untested and unsupported** in Fase 1. Do not imply RTL support.

## Adding copy

Add the key to **both** `it.json` and `en.json` in the same change (parity test). New copy belongs to its owning milestone; the M10 launch pass audits all namespaces but only owns `store.*` (store listing) and `prime.*` (founding cohort).
