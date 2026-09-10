# Athanor — Release & Store-Submission Runbook

**Milestone:** M10 Launch · **Spec:** `docs/superpowers/specs/2026-06-13-frontend-prd/10-m10-launch.md` §3.4–§3.7  
**Purpose:** Store-submission checklist and ops runbook for the Athanor Fase 1 release. Items already satisfied in code are noted; items that require external console/EAS/legal actions are tagged `⬜ ops` or `🔁 verify` so a human can execute them at release time.

**Status tags used throughout:**

| Tag               | Meaning                                                                        |
| ----------------- | ------------------------------------------------------------------------------ |
| `✅ code`         | Satisfied in shipped code (this or a prior slice)                              |
| `✅ posture`      | Satisfied by design/omission (no SDK, no tracker, no ATT prompt)               |
| `⬜ ops`          | Requires a human action in an external console/EAS/vault/legal at release time |
| `🔁 verify`       | Must be re-confirmed on the actual release build                               |
| `✅ ops`          | The human action this row asks for has been carried out and verified           |
| `🟡 partial`      | Some of the row is done; the cell says which half is outstanding               |
| `⬜ M8 follow-up` | Known gap flagged for resolution in the M8/IAP follow-up                       |

**Single go/no-go (R-9):** all gates G1–G7 green, cohort list ready, staged-rollout % set, rollback rehearsed → ship. Any red gate blocks submission.

---

## 1. Beta Distribution (B-1 … B-8)

| ID   | Item                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Status       | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B-1  | **iOS TestFlight** — `eas build --platform ios --profile preview` → `eas submit`. Internal + external TestFlight groups; external requires a beta-review pass. Expo SDK 57 (RN 0.86, 2026-09-05) changed the `fingerprint` runtimeVersion: no build made before it can take `dev` as an OTA — a fresh EAS build is required.                                                                                                                                                                                                                                                                                                                                                                                                         | `⬜ ops`     | Requires Apple Developer account, App Store Connect app record, `eas.json` production profile.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| B-2  | **Android Play internal track** — `eas build --platform android --profile preview` → `eas submit` to internal testing track; promote to closed/open as cohort grows.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | `⬜ ops`     | Requires Play Console service-account key in EAS secrets.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| B-3  | **Crash reporting (Sentry)** — `@sentry/react-native` with Hermes symbol upload in the EAS build; native + JS crashes captured; release tagged with app version + OTA update id.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | `⬜ ops`     | Code side ✅ (P1.4, 2026-07-08): `@sentry/react-native ~7.11.0` installed, consent-gated init (`SentryConsentGate`) + `beforeSend` PII scrub wired, `getSentryExpoConfig` in metro. Remaining ops: DSN + `SENTRY_AUTH_TOKEN`/org/project in EAS secrets, Hermes symbol upload in the EAS build, verify release tagging. Expo Go is no longer excluded (#452): with a DSN present it now gets JS-only telemetry over the fetch transport — no native crash capture, no offline caching, no replay — plus a durable step trail read back on the next launch. Native crash capture there still needs a dev/preview build (#83). **Interim deviation, 2026-08-19:** `apps/native/eas.json`'s `base` profile sets `SENTRY_DISABLE_AUTO_UPLOAD=true`, which `development`, `preview` **and `production`** all inherit, so no build currently uploads symbols at all — the creds this row calls for are what re-enables it. Tracked in #466.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| B-4  | **Privacy-respecting analytics** — crash-only, first-party/EU-region, IP-anonymized; no advertising SDKs, no third-party trackers (PRD §9 GDPR).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | `✅ posture` | No analytics SDK is installed. Fase 1 = crash-only telemetry. No ATT prompt; no product-analytics SDK. Declare "no tracking, no sale" in privacy-nutrition labels (S-4).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| B-5  | **Consent before any telemetry** — crash + analytics init deferred until user passes GDPR consent step (M9 `gdpr.*`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | `🔁 verify`  | M9 consent toggles are wired (`packages/i18n` `gdpr.*`, M9 slice). Sentry is installed (P1.4) and `Sentry.init()` is already gated behind the diagnostics consent via `SentryConsentGate` — verify on device before submitting.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| B-6  | **Feedback loop** — in-app «Segnala un problema / Invia feedback» via Settings → Supporto row; TestFlight feedback + Play pre-launch report monitored.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | `⬜ ops`     | Settings Supporto row (M1 §3.4) exists. Wire to a triage inbox (email/issue tracker) and monitor TestFlight/Play feedback channels.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| B-7  | **Staged rollout plan** — Prime Stelle cohort first → city expansion; crash-free-sessions ≥ 99.5% before widening rollout %.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | `⬜ ops`     | Requires Sentry (B-3) for crash-free metric. Set rollout % in App Store Connect phased release + Play staged rollout before widening.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| B-8  | **Maestro happy-path** — signup → dream → feed → event → momento flow runs green pre-submission.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | `⬜ ops`     | Maestro flows must be authored and run on a release build pre-submission.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| B-9  | **Auth hardening toggles (Supabase dashboard)** — MFA (TOTP) + password policy + leaked-password protection under Auth → Providers/Settings.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | `🟡 partial` | Flagged by the security advisor (2026-07-09). **Password policy done 2026-08-10, both projects** (minimum length 8 + "Lowercase, uppercase letters and digits"). **TOTP turned back off 2026-08-30 (#72 ruling):** `mfa_totp_enroll_enabled` + `mfa_totp_verify_enabled` = **false** on both projects — no client enrol/verify surface exists, so the enabled flags bought no security and opened a silent `mfa.enroll()` lockout trap. The free plan does accept TOTP (verified 2026-08-10), so re-enabling is one Management API call once a surface ships; `supabase/config.toml [auth.mfa.totp]` mirrors the off state. **Still open: leaked-password protection (HIBP) — the Management API rejects it with HTTP 402, it is Pro-plan only.** Revisit if the project moves off free. The "OTP-only, no passwords" premise once recorded here is false: the app signs in with `signInWithPassword`/`signUp` and calls `verifyOtp` nowhere, so HIBP would apply today if it could be enabled. The policy must mirror `packages/schemas/src/password.ts` — `packages/schemas/src/password.mirror.test.ts` pins that file to `supabase/config.toml`, but **no test can reach the hosted dashboard's third copy**. Re-verify by hand after any dashboard change.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| B-10 | **Google sign-in provider (Supabase dashboard + Google Cloud)** — **done 2026-08-24 on both projects**: provider on, Web-application client ID + secret set, staging first and production immediately after the device walk (#538). Verified 2026-08-26 against the Management API: `external_google_enabled` is true on both, each with a client ID set. `(auth)/welcome.tsx` ships `GOOGLE_ENABLED = true` with no environment split, which is why the order mattered — while production was off, a production build still rendered the CTA and could only reach «L'accesso con Google non è ancora attivo». ⚠️ The redirect-URL half of this row is NOT optional and NOT Google-specific — it moved to B-11, which applies today. | `✅ ops`     | Not settable via MCP/migrations, and `supabase/config.toml [auth.external.google]` stays `enabled = false` on purpose (an enabled provider with no `client_id` fails `supabase start` and breaks the CI `db` job). Google Cloud: OAuth consent screen (External) + **Web application** client — not iOS/Android, those are for the native SDK this app deliberately avoids — with authorized redirect URI `https://<project-ref>.supabase.co/auth/v1/callback`. Supabase → Auth → Providers → Google: paste ID + secret, leave _Skip nonce check_ OFF. Redirect URLs are B-11's list, not this row's — and no LAN-IP entry belongs on it: GoTrue substitutes Site URL for any private-LAN `redirect_to` whether or not it is listed verbatim, so Expo Go over LAN cannot be allow-listed at all (#73). **Exact URLs only — never a bare `exp://**`**: the publishable key ships in the bundle, so an unscoped wildcard lets anyone point `redirectTo` at their own host and collect a real auth code. The single exception is the domain-scoped exp.direct pair B-11 keeps on staging, and it stays off production.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| B-11 | **Auth redirect allow-list (Supabase dashboard)** — applies to EVERY hosted project, independent of Google/Apple. Auth → URL Configuration must contain **both** `athanor:///auth-callback` (three slashes — what a standalone build actually emits) and `athanor://auth-callback`, and, on production, **Site URL = `https://www.athanor.world`**. Staging also carries `exp://**.nip.io:8081/--/auth-callback` (added 2026-09-05): a LAN Metro fronted by a public hostname that resolves to the Mac's LAN IP (`EXPO_PACKAGER_PROXY_URL=http://<ip-dashed>.nip.io:8081 pnpm exec expo start`) returns at LAN speed, where the ngrok tunnel was DNS-blocked on the walk's WiFi and too slow on cellular. Never on production.       | `✅ ops`     | **Done 2026-08-10:** production Site URL set to `https://www.athanor.world`, and both callback forms added to both projects' allow-lists. The three-slash form is the one `createURL('/auth-callback')` returns — the standalone host is empty and expo-linking's `ensureLeadingSlash('', true)` yields `/` (8.0.12, `build/createURL.js:35-41`, template `:111-113`) — and matching is exact, so the two-slash form alone was never being hit. **Done 2026-08-24:** every cleanup item at the end of this cell, verified against both live allow-lists. The list stays because it records the intended end state and why. Split out of B-10 (2026-08-10) because it was only recorded there, under a Google premise that no longer holds — so an operator working this list would skip it and never learn why signup confirmation silently fails. `(auth)/welcome.tsx` passes `emailRedirectTo: AUTH_REDIRECT_URL` on `signUp`, so the confirmation mail deep-links to `athanor://auth-callback` (handled by `src/app/auth-callback.tsx`, which exchanges the PKCE `?code`). **GoTrue does not error on a URL missing from this list — it silently substitutes Site URL**, so the symptom is "confirmation opens a browser / the app never signs in", with nothing in any log. Site URL also backstops any future auth mail that carries no explicit redirect. ⚠️ **Production must never carry the bare wildcard `exp://**`.** It is gone, verified 2026-08-24. Reason: per B-10, the publishable key ships in the bundle, so an unscoped wildcard lets anyone repoint `redirectTo`, harvesting a real auth code. Expo Go belongs on the staging project — but **not** as a LAN-IP entry: GoTrue substitutes Site URL for any private-LAN redirect target, even when it is present in the list verbatim, so a plain LAN start can never complete a confirmation and no list edit changes that (#73, measured against staging). What staging carries instead:`exp://**.exp.direct/--/auth-callback`, `athanor://**.exp.direct/auth-callback`, and the two Simulator loopback entries `exp://127.0.0.1:8081/--/auth-callback`, `exp://127.0.0.1:8082/--/auth-callback`. The tunnel path (`pnpm exec expo start --tunnel`) matches the first pair; the Simulator's loopback GoTrue allows natively. That is domain-scoped, not the bare wildcard B-10 forbids — but exp.direct is a shared public domain, so keep that pair on staging only, never on production. The two dead entries `https://127.0.0.1:3000` and `http://localhost:3000/auth/confirm` (no such route exists) are gone, and `http://localhost:3000/admin/auth/callback` is present on staging — `app/admin/login/page.tsx` builds it from `window.location.origin`, so local admin magic-link login fails without it. |

---

## 2. Store Submission (S-1 … S-13)

| ID  | Item                                                                                                                                                                                                                         | Status                        | Notes                                                                                                                                                |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| S-1 | **App icon & splash** — `backgroundColor`, splash `backgroundColor`, and Android adaptive-icon `backgroundColor` set to `#0A0A1A` (cosmo).                                                                                   | `✅ code`                     | `apps/native/app.json` already declares `#0a0a1a` for background, splash, and adaptive-icon (M0.5 Part B). Native splash matches the JS splash void. |
| S-2 | **Screenshots** — hero set per device class, IT + EN: splash/wordmark, Profilo (mandorla avatar + Sei Stelle), a Momento match overlay, feed, Annual countdown. No vanity metrics; no fake Aura that implies a bought score. | `⬜ ops`                      | Generate from the release build on real devices (iPhone 6.9", iPhone 6.1", iPad 13"; Pixel 8). Upload to App Store Connect + Play Console.           |
| S-3 | **Store copy (IT + EN)** — name, subtitle, short description, full description, keywords, promo text, "What's new".                                                                                                          | `✅ code` (`⬜ ops` to paste) | `store.*` keys (8 keys) are in the IT + EN catalogs since the i18n-audit slice. Copy below — paste verbatim into consoles:                           |

### Store copy reference (`store.*` keys — paste into consoles)

| Key                                       | IT                                                                                                                                                                                                                                                                                                                                                                                         | EN                                                                                                                                                                                                                                                                                                                                                                  |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `store.name`                              | Athanor                                                                                                                                                                                                                                                                                                                                                                                    | Athanor                                                                                                                                                                                                                                                                                                                                                             |
| `store.subtitle`                          | Dove ogni incontro si accende                                                                                                                                                                                                                                                                                                                                                              | Where every encounter ignites                                                                                                                                                                                                                                                                                                                                       |
| `store.promo`                             | La tua reputazione si guadagna, non si compra.                                                                                                                                                                                                                                                                                                                                             | Your reputation is earned, never bought.                                                                                                                                                                                                                                                                                                                            |
| `store.description`                       | Athanor è la community dove conta ciò che fai davvero. Niente follower, niente metriche vanitose: una reputazione — l'Aura — che cresci solo con azioni reali. Scrivi il tuo sogno, spezzalo in piccole tappe, e lascia che le persone giuste lo facciano accadere. Incontri che contano, progetti veri, eventi dal vivo. Da qualche parte, qualcuno è il momento giusto per il tuo sogno. | Athanor is the community where what you actually do is what counts. No followers, no vanity metrics: a reputation — your Aura — you grow only through real action. Write your dream, break it into small steps, and let the right people make it happen. Encounters that matter, real projects, live events. Somewhere, someone is the right moment for your dream. |
| `store.shortDescription` (Play ≤80 chars) | Reputazione vera, incontri veri, progetti veri.                                                                                                                                                                                                                                                                                                                                            | Real reputation, real encounters, real projects.                                                                                                                                                                                                                                                                                                                    |
| `store.keywords`                          | community, reputazione, sogni, networking, incontri, progetti, eventi, mentorship                                                                                                                                                                                                                                                                                                          | community, reputation, dreams, networking, encounters, projects, events, mentorship                                                                                                                                                                                                                                                                                 |
| `store.whatsnew`                          | Athanor si accende. Questa è la prima luce: profilo, sogno, Momenti, community. Grazie per esserci dall'inizio.                                                                                                                                                                                                                                                                            | Athanor comes to life. This is the first light: profile, dream, Moments, community. Thank you for being here from the start.                                                                                                                                                                                                                                        |
| `store.privacyUrl.label`                  | Informativa sulla privacy                                                                                                                                                                                                                                                                                                                                                                  | Privacy policy                                                                                                                                                                                                                                                                                                                                                      |

> `store.description` character count must fit each store's limit (App Store ≤4000 chars, Play ≤4000 chars long desc / ≤80 chars short desc).

| ID   | Item                                                                                                                                                                                                                                                                                                                                                                                                                       | Status            | Notes                                                                                                                                                                                                                                                                                                                                                                                      |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| S-4  | **Privacy nutrition labels (iOS) / Data Safety (Android)** — declare: email (account), profile content, approximate location (PRD §9 "approximate by default"), payments handled by Stripe (not stored by app). **No tracking / no data sold / no third-party trackers.** In-app data deletion available (M9 export/erasure).                                                                                              | `⬜ ops`          | Fill App Store Connect Privacy → Data Types and Play Data Safety form. Must match B-4 (no analytics SDK). Declare data-deletion mechanism.                                                                                                                                                                                                                                                 |
| S-5  | **Age rating** — social-networking app with UGC + user-to-user messaging → 12+/Teen. Reporting/blocking present (M9).                                                                                                                                                                                                                                                                                                      | `⬜ ops`          | Complete each store's age-rating questionnaire honestly. M9 moderation features (reports + blocks) support UGC policy compliance.                                                                                                                                                                                                                                                          |
| S-6  | **Circle subscription IAP compliance (iOS)** — Apple requires auto-renewable IAP for digital subscriptions consumed in-app (Guideline 3.1.1). M8 ships Stripe Billing; iOS branch requires Apple IAP (StoreKit / `expo-in-app-purchases`) or the Circle CTA must be absent on iOS.                                                                                                                                         | `⬜ M8 follow-up` | M8 must branch by platform: Stripe Billing = Android/web; Apple IAP or no-CTA = iOS. This is not resolved in Fase 1 code; document it and do not ship a Stripe in-app subscribe button on iOS. See §5 (S-IAP-1).                                                                                                                                                                           |
| S-7  | **Fund contributions IAP compliance (iOS)** — one-off donation to a pooled fund via Stripe Checkout in an external web sheet on iOS (external purchase link), NOT an in-app Payment Sheet. Also gated by the `fund_editions.contributions_enabled` legal gate plus the `fund_surfaces_enabled` client flag (PRD §4.11).                                                                                                    | `🔁 verify`       | Verify the M7 contribute CTA on iOS opens `expo-web-browser` / Safari checkout and never an in-app Stripe Payment Sheet. Confirm `fund_surfaces_enabled` is OFF by default in `remote_config`. See §5 (S-IAP-2).                                                                                                                                                                           |
| S-8  | **`expo-doctor` clean** — passes after the last native dep change; `app.json` permissions, bundle IDs, version/build numbers correct; no dev-only plugin in the release profile.                                                                                                                                                                                                                                           | `🔁 verify`       | Run `pnpm exec expo-doctor` on the release build. Resolve any warnings before submission.                                                                                                                                                                                                                                                                                                  |
| S-9  | **Deep links** — `athanor://` scheme + universal/app links resolve through the auth gate for: Momento, event, post, `@handle`, invite. Associated-domains (iOS) + intent-filter / assetlinks (Android) configured.                                                                                                                                                                                                         | `🔁 verify`       | Verify cold-start deep-link routing on a release build. Configure Apple App Site Association + Android assetlinks.json on the web domain.                                                                                                                                                                                                                                                  |
| S-10 | **Push entitlements** — `expo-notifications` config plugin; APNs (iOS) + FCM (Android); permission prompt follows Athanor voice; entitlement present in the release build.                                                                                                                                                                                                                                                 | `⬜ ops`          | Upload APNs key + FCM config to EAS secrets / build profile. Confirm `expo-notifications` plugin is active in `app.json` plugins.                                                                                                                                                                                                                                                          |
| S-11 | **Export compliance & misc metadata** — encryption export-compliance (standard HTTPS → usually exempt, declare it), support URL, marketing URL (web landing), privacy-policy URL, copyright.                                                                                                                                                                                                                               | `⬜ ops`          | Set in App Store Connect + Play Console. Privacy-policy URL must be live before submission.                                                                                                                                                                                                                                                                                                |
| S-12 | **App Review Information — demo account + reviewer notes** (#84, 2026-09-03 comment; rows written 2026-09-10). A social app behind a sign-in wall with no credentials is a same-day 2.1 rejection. Needs a **production** member the reviewer can sign in as, seeded through the app so the world is not empty, and the notes below pasted verbatim.                                                                       | `⬜ ops`          | Procedure and notes text under "App Review Information" below. Credentials live **only** in App Store Connect → App Review Information — never in this file (public repo, push protection), never in mail. Prerequisite: the `apple_signin_enabled` flag ON and the Apple provider configured before submission (#79), because Google ships `const true` and 4.8 requires Apple beside it. |
| S-13 | **Guideline 5.1.1(v) — in-app deletion** (#84). The path exists: Settings → «Elimina account» → type the confirm word → confirm (`(modal)/delete-account.tsx`). Since 2026-09-09 production runs `erasure-nightly` at 03:47 UTC, so the account is erased within a day and the copy says so. **The credentials still authenticate until that run** — #733 closes that; until it lands the reviewer notes state the timing. | `🟡 partial`      | The confirm word is localised: `ELIMINA` on an Italian device, `DELETE` on an English one (`account.delete.confirmWord`). Flip to `✅` when #733 is on production.                                                                                                                                                                                                                         |

### App Review Information — reviewer notes (paste into App Store Connect, English)

**Paste only once `apple_signin_enabled` is ON in production's `remote_config` and the Apple provider is configured (#79).** Google ships unconditionally; with the flag OFF the sign-in sentence below is false to Apple, and 4.8 would be the rejection.

> Athanor is an Italian community app. The demo account is set to Italian; switch the device language to English for the English copy — every screen is localised.
>
> **Sign-in.** Use the demo email and password above. Sign in with Apple and Google are also offered on the welcome screen.
>
> **Circle (membership) on iOS.** There is no subscribe or manage button on iOS. Members on iOS see a note that Circle is not available here, with no link to any external purchase. The subscription is sold on Android only.
>
> **Event tickets** are for real-world, in-person events and are paid through Stripe Checkout in the system browser (goods and services consumed outside the app, Guideline 3.1.3(e)). No digital content or feature is unlocked by a ticket.
>
> **Fund contributions** (a once-a-year community fund) are behind a server-side flag and are OFF in this build.
>
> **Reputation.** The "Aura" score is earned only through actions and cannot be bought; nothing purchasable in the app changes it.
>
> **Account deletion.** Settings → «Elimina account» → type ELIMINA (DELETE on an English device) → confirm. The session ends immediately and the account, its content and its media are erased by a job that runs every night at 03:47 UTC; the app tells the member this. Until that run the credentials may still sign in.
>
> **Moderation.** Report and block are available on every profile and post; reports are reviewed by the team. Location is approximate (city level) and used for events and matching only.

Keep the notes to what the reviewer will see. Do not mention the fund cycle, Prime Stelle or anything behind a flag that is OFF.

### App Review Information — demo member on production (procedure)

Seeded **through the app**, never by SQL: production carries no seed, `seed-staging.sql` is a twelve-person world guarded twice against running anywhere but staging, and a hand-written `aura_scores` row would be the exact claim the product denies (rule 1). Two accounts are needed — a match, a conversation and a Momento all have two sides — and Marco's own production account is the second.

1. **Mailbox.** A real inbox Marco controls (an `@athanor.world` alias through Cloudflare Email Routing is enough). Check production's Auth settings first: `config.toml` records `mailer_autoconfirm = true` there, but that predates #70/#471 closing, and the built-in mailer is capped at 2 mails/hour — if confirmations are on, budget the wait.
2. **Sign up** in the production build with email + password. Onboarding: handle, display name, city, an adult birth date, bio, `identity_tags` / `seeking` from the in-app lists (an off-list key renders as the raw key string), avatar **uploaded from the device** (a browser upload writes a corrupt object at HTTP 200).
3. **A dream** with two or three milestones (`(modal)/dream-editor.tsx`), and one post. **Marco's account needs an active dream too**, and the two profiles' `identity_tags` / `seeking` must overlap: the matcher pairs only profiles that are not banned, both carry an active, non-deleted dream, and score an affinity above zero (`20260823145024_momento_suggestions_reasons_recomputed.sql`). Two "complete" profiles with disjoint tags or no dream on one side yield an empty deck.
4. **From Marco's account**: open a conversation with the demo member (`(modal)/new-message.tsx`) and exchange a few messages; send a collaboration request on the dream.
5. **Momenti.** The deck is filled by `momenti-matcher-nightly` at 03:11 UTC (`20260616044148`) under the preconditions in step 3. Finish steps 2–4 at least one night before `eas submit`, then confirm the demo member sees a Momento.
6. **Credentials** go into App Store Connect → App Review Information → Sign-in required. Store them in the password manager; nowhere else.
7. **Keep the account** through review and after. Do not run the deletion path on it; if a reviewer does, the nightly job erases it and the row above has to be repeated before any resubmission.

---

## 3. Platform-Resilience Gates (§3.5.1)

| Gate | Item                                                                                                                                                                                                                                                                 | Status       | Notes                                                                                                                                                                                                                                          |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| —    | **In-app account deletion** (Apple 5.1.1(v) / Google policy) — Settings → «Elimina account» → type ELIMINA → files a `gdpr_erasure_requests` row for the `erasure-job` edge function.                                                                                | `✅ code`    | Shipped in M9 GDPR slice. Session-revoke + erasure request entered from `(modal)/settings.tsx`, the flow lives in `(modal)/delete-account.tsx`.                                                                                                |
| —    | **Portrait-lock** (`app.json` `orientation: 'portrait'`) — no landscape in Fase 1.                                                                                                                                                                                   | `✅ code`    | `apps/native/app.json` declares `"orientation": "portrait"`.                                                                                                                                                                                   |
| —    | **iOS required-reason API manifest** — privacy manifest declares file-timestamp, UserDefaults, and other required-reason APIs.                                                                                                                                       | `🔁 verify`  | Verify the privacy manifest (`PrivacyInfo.xcprivacy`) is present and complete for every native API used. EAS build will warn if missing.                                                                                                       |
| —    | **Crash-report PII scrubbing** — Sentry `beforeSend` denylist: never log chat content, email, profile text, or tokens; scrub breadcrumbs + attachments.                                                                                                              | `⬜ ops`     | Implement `beforeSend` hook when B-3 Sentry is installed.                                                                                                                                                                                      |
| —    | **No ATT prompt / no tracking** — Fase 1 ships crash-only telemetry, no product-analytics SDK; no advertising IDs.                                                                                                                                                   | `✅ posture` | No ATT-requiring SDK installed. Declare "no tracking, no sale" in S-4.                                                                                                                                                                         |
| —    | **Force-update / maintenance-mode gate** — `BootGate` component reads `remote_config` at app boot and on resume; shows a force-update screen when the installed version is below `min_app_version`, and a maintenance screen when `maintenance_mode.enabled = true`. | `✅ code`    | Shipped in this slice (M10 beta-store-submission). `BootGate` lives at `apps/native/src/components/boot/BootGate.tsx`; `useRemoteConfig()` / `useFeatureFlags()` at `apps/native/src/hooks/use-remote-config.ts`. See §6 for ops instructions. |
| —    | **Offline-first end-to-end** — airplane-mode post → reconnect → queued mutation syncs.                                                                                                                                                                               | `🔁 verify`  | Verify on a physical device (airplane mode mid-session → reconnect). TanStack Query's retry + staleTime provide the buffering; confirm no data loss.                                                                                           |

---

## 4. Release Runbook (R-1 … R-9)

| ID  | Item                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Status                                     | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| R-1 | **Env / secrets** — `EXPO_PUBLIC_*` only in the app bundle (Foundation §2 — no service key in the client). Secrets (Sentry DSN, EAS submit credentials, APNs/FCM keys, Supabase anon key) in EAS secrets + Supabase vault + Cloudflare Workers secrets. Verify no secret in the JS bundle (grep the export).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | `⬜ ops`                                   | After `eas build`, download the `.app`/`.apk`, unzip, and `grep -ri "service_role\|sb_secret_\|sentry_dsn\|sk_live"` over the extracted JS bundle. Any hit is a release blocker. `.env.example` must be kept current. Stripe's own variables move from test mode to live mode at the same release: §4.2 lists the endpoint inventory and every Stripe variable that has to move with them.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| R-2 | **Feature flags** — `useFeatureFlags()` reads the `remote_config` table at boot. Five well-known keys, three of them feature flags, gate Fase-1 features and the Apple sign-in CTA. Remote-toggleable without a store build.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | `✅ code`                                  | `apps/native/src/hooks/use-remote-config.ts` exports `useFeatureFlags()`. Current flags and their defaults: `fund_surfaces_enabled` (default OFF — client visibility for fund surfaces; the legal gate is `fund_editions.contributions_enabled`, PRD §4.11), `prime_stelle_enabled` (default OFF — launch cohort gate), `apple_signin_enabled` (default OFF — reveals the «Continua con Apple» CTA on `(auth)/welcome.tsx`; #79). See §6 for how to flip flags as service_role. ✅ The §6.5 rename is **done** — production carries `fund_surfaces_enabled`, verified 2026-09-07; the old ⚠ here said otherwise and was stale.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| R-3 | **Rollback** — JS-only regression: republish the previous `expo-updates` build via `eas update`. Native regression: halt phased release (App Store Connect phased-release pause; Play staged-rollout halt) and expedite a new store build.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | `⬜ ops`                                   | Document who can trigger each path and how. Rehearse OTA rollback before launch (publish a known-good update, confirm devices pick it up within the `staleTime` window).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| R-4 | **Monitoring (Sentry)** — Sentry project live (B-3); alerts on crash-free-sessions drop, new-issue spikes, and release-health regression. `mcp__sentry__*` tools available in this environment for querying issues during incident response. Dashboards: crash-free %, slow-frames, cold-start.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | `⬜ ops`                                   | Configure Sentry project, DSN, release-health alerts, and dashboard before widening rollout. The Stripe webhook backlog is **not** covered by Sentry: it is the manual query in §4.1, run on go/no-go day and daily through launch week (#474).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| R-5 | **Versioning** — Settings version footer reads `Constants.expoConfig.version` (never hardcoded). `app.json` semver + `eas.json` `autoIncrement` for native build numbers. OTA update id available in debug/support info. `app.json version`, `package.json`, and the store version must be aligned per release.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | `✅ code`                                  | `apps/native/src/app/(modal)/settings.tsx` reads `Constants.expoConfig?.version` and renders via `t('settings.version', locale, { version })`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| R-6 | **CI gates green before tagging** — `typecheck · lint · core unit ≥90% · schemas contract · pgTAP (incl. "client cannot write score") · edge-fn deno test`. Stop quality-gate (typecheck+lint), literal-hex hook, migration append-only hook pass. `athanor-reviewer` run on the release diff (CLAUDE.md). **No _mobile_ e2e gate exists**: `apps/web` came back in merge `34ff635` and CI runs its Playwright smoke again as the `web e2e (Playwright)` job, but the Maestro flows of B-8 were never authored — until B-8 lands, the mobile happy path is a manual pass, not a CI gate.                                                                                                                                                                                                                                                            | `🔁 verify`                                | Run the full CI suite on the release branch. Confirm `athanor-reviewer` returns PASS with zero Blockers.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| R-7 | **EAS Build on release tag** — production profile builds both platforms; uploads Sentry symbols/source maps; submits via `eas submit`. Runtime-version policy set so native changes force a store build while JS-only fixes ship OTA.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | `⬜ ops`                                   | Configure `eas.json` production profile with `sentry-cli` upload step, correct `runtimeVersion` policy, and submit credentials. Tag the release commit and trigger the EAS build. **Not true today (2026-08-19):** the `base` profile disables the upload for every profile, production included — deliberate while `SENTRY_AUTH_TOKEN`/org/project are unset on EAS, reversed by deleting that one key. #466.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| R-8 | **GDPR / data-residency final check** — Supabase EU/Frankfurt region confirmed (project `kwzeiqvrnnaagccyoose`, Frankfurt); consent captured at signup (M9); self-serve export + ≤30-day erasure wired (M9 `gdpr-export-job` + `erasure-job` edge functions, both deployed); **`erasure-job` requires `20260827110034`, `20260908071656` and `20260908073545` on the target project before it is deployed there, and the `app.settings.erasure_job_url` / `_key` Vault pair before the cron does anything** — it calls `gdpr_storage_footprint` (#573), `gdpr_erase_payment_footprint` and `gdpr_release_profile_references` (#107), and against a project missing any of them every request answers `PGRST202`, lands on the terminal `failed`, and is never re-queued; privacy-policy URL live (S-11); no third-party tracker in the build (B-4). | `✅ ops` (production rider run 2026-09-09) | Supabase EU region ✅. M9 consent + GDPR export/erasure slices are shipped, and since **#107** the erasure cascade is complete and **scheduled**: `erasure-nightly` at 03:47 UTC (`20260908071807`) posts to `erasure-job`, which pseudonymises the retained payment rows, releases the blocking references, purges the waitlist and deletes the account — a clean pass now ends `done`. **Do not assert the deploy from memory — run `pnpm deploy:check` (§4.3), which reads both hosted projects and fails if any repo edge function is undeployed.** Two riders gate this on each project: the **migrations before the function deploy** (see §4.4 — `20260827110034`, `20260908071656` and `20260908073545` are all called by the job, and a missing one is a `PGRST202` on the terminal `failed`), and then the **`app.settings.erasure_job_url` / `_key` Vault pair** (§5) — until that pair exists the wrapper no-ops and nothing runs. The retention question was **ruled by the controller on 2026-09-07** (#184: payment rows are pseudonymised and kept 10 years, everything else is deleted on request); the 10-year reaper that finally drops the pseudonymised rows is **#715**, and it has landed (`20260909085841`, re-signed by `20260909093945`): the `gdpr-retention-reap` cron job runs daily at 04:53 UTC, in pure SQL, and needs **no Vault pair and no function deploy** — the migration alone arms it. It deletes from `event_tickets`, `circle_memberships` and `fund_contributions` only where `erased_at` is older than `gdpr_retention_window()` (`interval '10 years'`), and never touches a row whose `erased_at` is NULL however old. **Nothing can age out anywhere before 2036-08-15** — the first erasure ran 2026-08-15 — so on both projects this job is a no-op scan for the next decade, which is exactly why it has to be correct now rather than watched later. See §5. Reconcile any pre-#107 `partial` / `failed` rows with the procedure in §7.5. **This row stayed `🟡` until the §5 rider had run on PRODUCTION, and that was deliberate: the wrapper is a silent no-op without the Vault pair, so a project that skips the rider erases nothing and says nothing — while the shipped app copy («la eseguiamo ogni notte» / «we run it every night») is already telling members it does. The gate sat here because nothing else fails loudly.** The flip condition was `select public.invoke_erasure_job();` on production returning a `200` in `net._http_response` **whose body reads `"retained":0`** — a 200 alone does not prove the job erased anybody, because a project missing the `CF_KV_*` trio answers 200 with every request `failed` and every account still standing. **Flipped 2026-09-09** (release PR #727): production received the three migrations, `erasure-job` v14 and the `app.settings.erasure_job_url` / `_key` Vault pair, and the smoke answered `200 {"seen":0,"kvPurge":{"configured":true,"deleted":0,"failed":0},"retained":0,"storageRemoved":0}` — `kvPurge.configured:true` is what proves the `CF_KV_*` trio, since a zero-request pass exercises nothing else. If the pair or the `CF_KV_*` trio is ever rotated away, this row goes back to `🟡` and the same smoke is the way back. |
| R-9 | **Go / no-go** — gates G1–G7 green; Prime Stelle cohort list ready; staged-rollout % set; rollback rehearsed; sign-off recorded.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | `⬜ ops`                                   | Review §10 (acceptance gates G1–G7) line by line. No submission until every gate is green. Record sign-off with date and approver.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |

### 4.1 Webhook backlog — the daily `processed_at IS NULL` check (#474, ruling 2026-08-21)

`stripe-webhook` was built around a standing alarm. Every delivery lands a `stripe_webhook_events`
row **before** any work happens, and `processed_at` is stamped only after processing succeeded — so
a row with `processed_at` still NULL is money Stripe has taken that Athanor has not acted on. The
handler says so in as many words — "a standing, queryable alarm"
(`supabase/functions/stripe-webhook/handlers.ts:46`), echoed as "a standing alarm" at `:589`.
Nothing queries it: no `pg_cron` job, no edge function, no Sentry rule.

**Ruling (2026-08-21, #474): this stays a manual check the operator runs, not a built alarm.**
Pre-launch volume is single digits, an automated alarm would need a delivery surface for
backend-only conditions that does not exist yet (and would become its own launch dependency), and
an alarm wired today would be red from its first tick for a reason a query already explains (see
the baseline warning below). Revisit when live-mode volume makes a daily eye impractical — the
query below is exactly what such an alarm would run.

**Run it against production only** (`kwzeiqvrnnaagccyoose`). Staging breaks payments deliberately
during QA and `staging-refresh-world` rewrites the world hourly, so a NULL there is expected noise,
not signal.

The table is service-role only — `revoke all … from anon, authenticated`, RLS on with zero policies
— so the check needs a privileged connection: **Dashboard → SQL Editor** on the production project.
Do **not** `supabase link` production to run it: `supabase/.temp/linked-project.json` is a single
global that `db push` and `functions deploy` obey, and leaving it pointed at production is how an
unintended migration push happens. Against staging, `supabase db query --linked` is fine.

**1. Triage — the three states in one row of counts.**

```sql
select
  count(*)                                                            as total,
  count(*) filter (where processed_at is not null)                    as processed,
  count(*) filter (where processed_at is null and claimed_at is null) as never_claimed,
  count(*) filter (where processed_at is null
                    and claimed_at >= now() - interval '10 minutes')  as in_flight,
  count(*) filter (where processed_at is null
                    and claimed_at <  now() - interval '10 minutes')  as stale_claim
from public.stripe_webhook_events
where received_at > now() - interval '7 days';
```

The timestamp column is `received_at` — there is no `created_at` on this table. The ten minutes is
`LEASE_MS` (`supabase/functions/stripe-webhook/handlers.ts:19`, `10 * 60_000`); re-derive it from
there if it ever changes, because the window has to exceed the lease or a healthy in-flight
delivery reads as an alarm.

The three unprocessed states are not the same thing:

- **`in_flight`** — claimed inside the lease window. A delivery is being processed right now, or an
  isolate crashed and its lease has not expired yet. Benign. Recheck after the lease.
- **`stale_claim`** — claimed, lease expired, never finished: an isolate died mid-processing.
  Stripe's next retry re-claims and reprocesses it; if Stripe's retry budget has run out (below),
  nothing will.
- **`never_claimed`** — either the row is seconds old, or `processEvent` threw, released the lease
  and returned 500. Sustained non-zero here is the failure mode #473 found on production.

**2. The rows behind a non-zero count.**

```sql
select event_id, type, received_at, claimed_at,
       date_trunc('second', now() - received_at) as age
from public.stripe_webhook_events
where processed_at is null
  and received_at < now() - interval '15 minutes'
order by received_at
limit 50;
```

Fifteen minutes is the lease plus margin. Never `select *` here — `payload` holds the entire Stripe
event: amounts, customer identifiers, email.

**3. What the operator does with a row.** Take its `event_id` to the Stripe Dashboard → Developers
→ Events and read the delivery attempts and the endpoint's responses, then read the `stripe-webhook`
function logs for the same id (the throw path logs `process failed <event_id>`). Per rule 6 the
money moved regardless — Stripe is the source of truth and these rows are only a cache — so a
persistent NULL means a member may have paid for a ticket, a Circle month or a fund contribution
and received nothing for it. That is the reading, and it is why this count is checked rather than
assumed.

Recovery is a resend, never a database edit: Dashboard **Resend** works for 15 days after the
event, `stripe events resend <event_id> --webhook-endpoint=<endpoint_id>` for 30. Do not hand-stamp
`processed_at` — that marks an event done without doing it and permanently suppresses the retry.

**Stripe's retry budget is the clock.** In live mode Stripe retries a failing delivery with
exponential backoff **for up to three days** and then stops (a sandbox event gets three attempts
within a few hours). A row still NULL after that window will never self-heal, and repeated failures
also count toward Stripe disabling the endpoint — the concern behind #473 and behind the
delayed-notification ordering note in `docs/PRODUCTION-READINESS.md` Appendix A step 4. Three days
is therefore the outer bound on how late this check can run and still be recoverable by retry.

**Cadence.** Once on go/no-go day (R-9), then every morning through launch week, then whenever a
payment complaint arrives. It costs one query.

**The baseline is zero, since 2026-08-24.** #473 measured **9 rows, every one `processed_at` NULL,
oldest 2026-08-18**, on production: deliveries from the _test-mode_ Stripe account, which was then
registered as an endpoint on production as well as on staging. They could never process — the
profiles and events they referenced exist only on staging — and they were not real money. All nine
`event_id`s are recorded on #473 and the rows were deleted on 2026-08-24; production
`stripe_webhook_events` now counts 0. Any non-zero from here is real. §4.2 is what keeps it that
way.

**Performance.** `stripe_webhook_events` carries exactly one index, the `event_id` primary key, so
both queries are sequential scans. At this table's size that is the right answer and no index is
warranted. If the ledger ever grows enough for the daily check to drag, the fix is a partial index
(`… (received_at) where processed_at is null`) rather than a wider one — but that is a migration,
and nothing today needs it.

### 4.2 Stripe webhook endpoints — the inventory, and the test → live swap (#473)

§4.1 asks whether production **processed** what it received. This asks the prior question: whether
production should have received it at all. `supabase/ENV-NOTES.md` had recorded two endpoint ids,
but nothing recorded **where each one pointed, or in which mode** — which is why #473 took a
Dashboard hunt across two modes plus a SQL query against production to establish something a lookup
should have answered in a line.

**The rule.** Every Stripe webhook endpoint is attributable to exactly one Supabase project, one
mode and one **scope**, and **production is only ever reachable from a live-mode endpoint**. An endpoint nobody can
attribute gets deleted, not left. The reason is that a signing secret is per-endpoint _and_
per-mode: a test-mode `whsec_…` can never verify a live event, and the reverse — a production
project holding a test-mode secret — is the shape #473 took. Production verified staging's test
traffic, stored it, and 500ed on every row, because the profiles those events referenced exist only
on staging.

#### Inventory — test-mode sandbox `acct_1U23HsQ27ZDmslJ8`, as of 2026-08-24

| Endpoint points at                | Should it exist                  | State on 2026-08-24                                                                                                                                                                                                                |
| --------------------------------- | -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| staging `eralyiwkfrpqsawivegz`    | yes — this is the QA rail        | present, and the only endpoint aimed at a Supabase project                                                                                                                                                                         |
| production `kwzeiqvrnnaagccyoose` | **never** in this mode           | deleted, and proven gone under load: a four-leg staging walk moved staging 11 → 16 while production stayed flat at 9 (#473, 2026-08-23)                                                                                            |
| a **Vercel** URL                  | unknown — origin unidentified    | present. Stale by definition, since `apps/web` runs on Cloudflare Workers; possibly the upstream's (`kaira-app`). **Identify it or delete it before the live swap** — an unattributed endpoint must not be carried into live mode. |
| anything live-mode                | at cutover, one per live project | none — no live-mode account or endpoint exists yet                                                                                                                                                                                 |

#### Scope is a third axis, and the inventory above did not have it (2026-09-06, #702)

An endpoint's **scope** is fixed when it is created — Workbench's **Events from**, the API's
`connect` parameter — and it decides which events reach it at all:

- **Your account** (`connect: false`) — Checkout, Billing, Identity, charges, transfers. Everything
  `stripe-webhook` handled until #702.
- **Connected accounts** (`connect: true`) — a connected account's v1 `account.updated`, and every
  other event a connected account raises. These carry a top-level `account` field naming it.

A connected account's `account.updated` is delivered **only** to the second kind. Both endpoints in
the inventory above are the first kind, so W13 — the arm that maintains `payout_accounts`, and
therefore the only thing that can open #247's transfer gate — had never fired once: correct code,
no event. Staging proved it on 2026-09-06: 17 rows in `stripe_webhook_events`, **zero** of type
`account.updated`, and both real `acct_1UCj…` accounts sitting all-false with `onboarded_at` NULL.

A signing secret is **per endpoint**, so a second scope is a second endpoint AND a second secret.
Four are needed in all, and each needs its own `whsec_…`:

| Project                           | Scope              | Variable                        | State on 2026-09-06                               |
| --------------------------------- | ------------------ | ------------------------------- | ------------------------------------------------- |
| staging `eralyiwkfrpqsawivegz`    | Your account       | `STRIPE_WEBHOOK_SECRET`         | exists (the endpoint in the inventory above)      |
| staging `eralyiwkfrpqsawivegz`    | Connected accounts | `STRIPE_CONNECT_WEBHOOK_SECRET` | **to create** — Dashboard endpoint + secret (#80) |
| production `kwzeiqvrnnaagccyoose` | Your account       | `STRIPE_WEBHOOK_SECRET`         | at cutover, live mode — the table below           |
| production `kwzeiqvrnnaagccyoose` | Connected accounts | `STRIPE_CONNECT_WEBHOOK_SECRET` | at cutover, live mode — the table below           |

Both endpoints point at the same URL (`/functions/v1/stripe-webhook`); the function verifies a
delivery against each secret it holds and skips the ones it does not
(`functions/_shared/stripe.ts`, `webhookSigningSecrets` / `verifyWithAnySecret`). Neither secret is
boot-fatal — an unset one costs only its own scope's events, exactly the 400 an unset
`STRIPE_WEBHOOK_SECRET` has always meant, and the function warns once per cold start naming what is
missing. So the deploy may precede the secret; only the events wait.

Recorded `we_…` ids live in `supabase/ENV-NOTES.md`, under **Stripe reference**. That table predates
#473, lists two destinations, mentions no Vercel endpoint and records an event count of 10 that the
handler has since outgrown, so reconcile all three against the Dashboard whenever this inventory is
re-taken. Read its "live config" label as _current configuration_, not
live **mode**: everything in that table is the test-mode sandbox.

**Re-taking it.** `pnpm payments endpoints` is the fastest read — it prints each endpoint's
**scope**, names the Supabase project its URL points at, and raises a `⚠⚠` when the mode being read
has no «Connected accounts» endpoint at all. It is the one command in that script permitted a live
key, and only to read; `stripe()` refuses to pair the live key with anything but a bodyless GET.
`stripe webhook_endpoints list --limit 100` and Dashboard → Developers → Webhooks answer the same
question by hand. Scope is not a labelled field on the retrieved object: what distinguishes the two
is `application`, which carries a `ca_…` Connect application id on a «Connected accounts» endpoint
and `null` on an account one (`connect` exists only on create params).

Run it **once per mode**, and note that the mode is never a filter you can see: the Dashboard's
test/live toggle hides the other mode's endpoints entirely, and the CLI takes the mode from
whichever key is configured (`--live` for the live set). That is precisely how a stale endpoint
survives a review. Record the `we_…` id of anything kept — §4.1's recovery path
(`stripe events resend <event_id> --webhook-endpoint=<id>`) needs it.

#### When the cache is already wrong — `reconcile-payout-accounts` (#707)

An endpoint created after an account has already onboarded does not catch up. A connected
account's `account.updated` is delivered only to a «Connected accounts» endpoint, Stripe refuses
endpoint-targeted resend for a connected account's events, and `payout_accounts`' capability
columns are written by nothing else. So a completion event that fired into a window with no
subscriber is gone, and the row stays wrong forever with **no failure anywhere** — an event that
was never delivered leaves no row in `stripe_webhook_events`, which is why §4.1's backlog query
cannot see this and never will.

That happened on 2026-09-06: two organisers onboarded at 17:01 and 17:31 UTC, the connect-scoped
endpoint was created at 18:31, and one row sat at `payouts_enabled = false` for a day while Stripe
reported `true`. The organiser sees the Connect-your-account CTA forever and every refetch confirms
it, because the screen re-reads the same stale table.

`reconcile-payout-accounts` retrieves each account from Stripe and writes the cache through the
same function the W13 arm uses. It is **internal service-role**, so the secret goes on the
`apikey` header — never `Authorization`, which the platform parses as a JWT:

```bash
# every row
curl -s -X POST "https://<project-ref>.supabase.co/functions/v1/reconcile-payout-accounts" \
  -H "apikey: $SB_SECRET_KEY" -H 'Content-Type: application/json' -d '{}'

# one account
curl -s -X POST "https://<project-ref>.supabase.co/functions/v1/reconcile-payout-accounts" \
  -H "apikey: $SB_SECRET_KEY" -H 'Content-Type: application/json' \
  -d '{"stripeAccountId":"acct_…"}'
```

It answers `{checked, corrected, failed, outcomes}`; a `corrected` outcome names the flags on both
sides, so the log says what moved. A Stripe failure on one account does not abort the rest.

**Run it after** creating a webhook endpoint on an account that already has connected accounts,
after any period where `stripe-webhook` was failing or its signing secret was unset, and whenever
an organiser reports being stuck behind the payout CTA. **Nothing schedules it** — a `pg_cron`
sweep is what would also catch the reverse case, a capability Stripe _revokes_ while the endpoint
is down, which leaves the cache reading `true` and `release-fund-payout` transferring to an account
that can no longer receive one. That is a separate decision with a migration behind it.

#### Cutover — swap every `STRIPE_*` variable, not only the webhook secret

Production's edge-function env is still test-mode. `STRIPE_WEBHOOK_SECRET` is **unset** as of
2026-08-24 (#473 step 2), which fails closed: no secret, no signature verification, 400, nothing
written. `STRIPE_CONNECT_WEBHOOK_SECRET` is unset there too and fails closed the same way — it is
the newest of the five (#702) and has never held a production value in any mode. The other three
still carry **test-mode** values — inert for webhooks, but a checkout function invoked on
production would mint test-mode sessions against live members. The swap is therefore all five
together, or none.

A **half** swap is now visible to members rather than merely wrong (#644). Since the Circle join
CTA renders only once `get-circle-prices` has returned a live amount, a production holding a
live `STRIPE_SECRET_KEY` beside test-mode price ids fails `prices.retrieve` cross-mode, and the
screen shows «Non siamo riusciti a leggere i prezzi.» with no way to subscribe — for everyone,
silently, until the ids are swapped too. That is a feature of the fix, not a regression: the
alternative was quoting a price nobody could be charged. It does mean the price ids are no
longer the low-stakes member of this table.

| Variable                        | Read at                                                                                                                                          | Live value                                                    |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------- |
| `STRIPE_SECRET_KEY`             | `supabase/functions/_shared/stripe.ts:52`                                                                                                        | the live-mode secret key, or a restricted key                 |
| `STRIPE_WEBHOOK_SECRET`         | `supabase/functions/_shared/stripe.ts:154` (`webhookSigningSecrets`, resolved at `stripe-webhook/index.ts:13`)                                   | the new live **Your account** endpoint's signing secret       |
| `STRIPE_CONNECT_WEBHOOK_SECRET` | `supabase/functions/_shared/stripe.ts:155` (same resolver, #702)                                                                                 | the new live **Connected accounts** endpoint's signing secret |
| `STRIPE_PRICE_CIRCLE_MONTHLY`   | `supabase/functions/_shared/stripe.ts:124` (`circlePriceIds`, the one resolver both `create-circle-checkout` and `get-circle-prices` call, #674) | the live-mode price id                                        |
| `STRIPE_PRICE_CIRCLE_ANNUAL`    | `supabase/functions/_shared/stripe.ts:125` (same resolver)                                                                                       | the live-mode price id                                        |

Those five are the whole set: no other `STRIPE_*` **environment variable** is read anywhere in the
repo. Other names look like they belong here and do not. `STRIPE_API_VERSION` is a code
constant (`supabase/functions/_shared/stripe.ts:19`), deliberately, so that it cannot be set
per-environment and must move in lockstep with the Dashboard webhook endpoint —
`supabase/ENV-NOTES.md` records why. It does **not** track the SDK: `npm:stripe@22` floats
(`supabase/functions/deno.lock` is gitignored) and has already moved past it (`2026-07-29.dahlia`
as of 2026-08-26; re-read the SDK rather than trusting this literal),
so the constructor casts to keep the older pin. Advancing the constant to match the SDK
without re-creating the endpoint at the same version is the payload-shape incident this pin
exists to prevent. `STRIPE_FEE_BPS`
and `STRIPE_FEE_FIXED_CENTS` are named constants in `packages/core` (`src/fund/fees.ts`), which is
where rule 10 requires them; they describe Stripe's pricing, not Athanor's configuration, and
nothing about the cutover moves them. `STRIPE_IDENTITY_WEBHOOK_SECRET` appears in the backend spec
and was never implemented — Identity rides `stripe-webhook` on the W9/W10 arms, under the
**platform** signing secret above (Identity sessions belong to the platform account, not to a
connected one, so they arrive on the «Your account» endpoint).

**Order, and it matters.**

1. **Deploy the functions to production first** — §4.3, `pnpm deploy:check`. An endpoint created
   ahead of its handler collects failures, and repeated failures count toward Stripe disabling the
   endpoint, on the same budget §4.1 describes. That check reads deployed function versions and
   Vault secret _names_; it cannot read edge-function env values, so it can never tell you whether
   the swap below has happened. Nothing automated can — which is why this is a written step.
2. **Create the live-mode endpoints — plural, one per scope** (#702), at the pinned API version
   and with the required enabled events. `account.updated` belongs on the **Connected accounts**
   one and is delivered nowhere else; everything else belongs on **Your account**. Both already have a home in §5 and are not restated here: the **Webhook endpoint API
   version** rider for the version, the **Payout transfer deploy config** rider (#247) for
   `transfer.created` / `transfer.reversed`, and the **Payout onboarding deploy config** rider
   (#246) for `account.updated`. Read the last one whole, and the **Stripe https return pages**
   rider (#418) with it: live mode is where Stripe starts rejecting the non-HTTPS return URLs those
   two riders configure, so a cutover that only swaps keys can still land a broken Connect flow.
3. **Set all four variables together** on production, with
   `supabase secrets set --project-ref kwzeiqvrnnaagccyoose`. The signing secret exists only once
   step 2 has run, which is why it comes last and why unset is the right interim state rather than a
   gap to be filled early.
4. **Re-take the inventory** above, and confirm three things: no test-mode endpoint points at
   production, the Vercel endpoint is identified or gone, and exactly one live-mode endpoint points
   at production.
5. **Verify with §4.1's query**, never by assertion. After the first live payment `total` rises and
   `never_claimed` returns to 0. A live delivery that lands and never processes is the failure this
   whole ordering exists to prevent.
6. **Smoke the price read as a real member** (#674). This is the one probe that sees the half
   swap described above, and it costs nothing: `get-circle-prices` reads two Prices and writes
   nothing. It is user-callable (`requireUser`), so an anon-key call gets 401 — mint an access
   token for a real production account first. The version gate (§6.4) fails open without the
   `x-app-version` headers, so a bare curl passes it.

   ```bash
   REF=kwzeiqvrnnaagccyoose
   PUB=<production publishable key>   # sb_publishable_… — never a secret key
   read -rs -p 'password: ' PASS       # prompted, so it never lands in shell history
   TOKEN=$(jq -n --arg e '<your account>' --arg p "$PASS" '{email:$e,password:$p}' |
     curl -s "https://$REF.supabase.co/auth/v1/token?grant_type=password" \
       -H "apikey: $PUB" -H "Content-Type: application/json" -d @- | jq -r .access_token)
   unset PASS
   curl -s -X POST "https://$REF.supabase.co/functions/v1/get-circle-prices" \
     -H "apikey: $PUB" -H "Authorization: Bearer $TOKEN" \
     -H "Content-Type: application/json" -d '{}'
   ```

   Expected: `200` with `{"monthly":{"unitAmount":…,"currency":"eur"},"annual":{…}}`, and the
   two amounts are the live Dashboard's — eyeball them there, because nothing else in the system
   carries them (#644). `500 {"error":"could not load prices"}` is the cross-mode half swap (a
   live secret key resolving test-mode Price ids, or the reverse; Stripe answers
   `resource_missing`) and the function logs carry the Stripe reason. `500 {"error":"price not
configured"}` means an id is unset or its Price failed a gate (archived, one-off, wrong or
   multi-period interval, tiered); the same logs name the plan and the gate (#674). The read is
   memoized for 60s per isolate, so a fix can take up to a minute to show. Run it again after
   step 4 if the ids were swapped last.

### 4.3 Deploy parity — `pnpm deploy:check` (#472)

Nothing else in this repo can see whether an edge function is actually **deployed**.
`_shared/config-invariants.test.ts` asserts the auth-posture table in a _file_, so it is equally
green whether a function is deployed to zero projects or two; `#80` counts _migrations_, which is
why #468 (`moderation-enforce` applied on production, function never deployed — bans recorded a
verdict and never stopped anyone signing in) sat unseen from 2026-08-13 to 2026-08-20; and every
deploy claim in this runbook was, until now, prose. Run the check instead of reading the sentence:

```bash
pnpm deploy:check
```

Read-only — it never deploys, never links, and never touches
`supabase/.temp/linked-project.json`. It needs the operator's own Management API token
(`$SUPABASE_ACCESS_TOKEN`, else the `supabase login` keychain entry); nothing in CI holds one,
which is why this is a local pre-release command and not a workflow.

What it prints, per repo function, for **both** projects: deployed version, age, and status; then
the Vault secret **names** each project holds (never a value). Drift has been observed in both
directions — production behind staging (#468) and staging's `stripe-webhook` ten days stale while
it silently failed to issue paid tickets — so the report is symmetric.

**It exits non-zero for exactly one thing: a repo function missing from staging or production.**
Everything else is printed for a human to judge, deliberately:

| Reported, not gated                                                 | Why not a gate                                                                                                                                                                           |
| ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| deploy **age**                                                      | There is no honest threshold. `announce-cycle` has legitimately not changed in months; ten days was fatal for `stripe-webhook`. The number is for the operator, the gate would cry wolf. |
| an **orphan** — a slug deployed with no repo directory              | Deleting a live function is a decision, not something a checking script should imply.                                                                                                    |
| a deployed **`verify_jwt`** disagreeing with `supabase/config.toml` | Rule 8's table is asserted against the file; this is the first thing that compares it to what is running. New signal — watch it before gating on it.                                     |
| a **Vault name** present on one project only                        | Half of #468 was `app.settings.moderation_enforce_url`/`_key` missing on production, which turned the fan-out into a silent no-op.                                                       |

One exception is encoded rather than flagged: **`app.settings.environment` exists on staging and
must NEVER exist on production.** It is one of the two factors guarding `seed-staging.sql`, so its
absence on production is correct; the check prints it as expected, and shouts if it ever appears on
production. `packages/api/src/deploy-check.test.ts` pins that behaviour.

---

### 4.4 Deploy ORDER when a migration emits a new push template key (#523)

`deploy:check` answers "is it deployed"; this answers "in which order", and they are different
questions. A migration that starts emitting a `notif.tpl.*` key the **deployed** `push-dispatch`
does not know fails **silently and unrecoverably**:

- `buildPushMessages` returns `[]` for an unknown key (`_shared/notif-templates.ts:277-278`);
- `push-dispatch` returns `200 {sent:0,failed:0,pruned:0}` on the zero-message path **before**
  it reaches its `report()` log (`push-dispatch/logic.ts:152`), so there is no console line;
- a 200 is a delivered dispatch, so the #521 outbox marks it done — **no retry, no
  `abandoned_at` row, nothing for `admin_list_abandoned_dispatches` (§#534) to ever show.**

The in-app notification degrades gracefully in this window — an unknown key falls back to
`notif.tpl.generic` (`packages/schemas/src/notification.ts`) — so the member still sees
_something_ in the centre. Push degrades to nothing at all, and leaves no trace that it did.

**Rule: deploy the function first, apply the migration second.**

```bash
supabase functions deploy push-dispatch    # the mirror learns the key …
supabase db push                           # … before anything can emit it
```

That order is safe **when the migration is what starts depending on the function**: a deployed
template nobody emits yet is inert, while an emitted template nobody can render is a lost
notification. The same reasoning covers any function a migration starts depending on —
`notification-fan-out` is **not** one of them, since it treats `template_key` as an opaque string
and passes it through.

**The reverse dependency inverts the rule, so read which way it points before deploying.** When a
function starts depending on a _migration_ — calling an RPC that migration creates — the migration
must land first, and a deploy in the documented order breaks it. `erasure-job` is the live case
and it now has **three** of these, not one: since `20260827110034` it calls `gdpr_storage_footprint`
(#573), and since `20260908071656` it also calls `gdpr_erase_payment_footprint` and
`gdpr_release_profile_references` (#107). Against a project missing any of them the request answers
`PGRST202` **after** the fund transaction has already run, so it lands on the terminal `failed` that
nothing re-queues. `20260908073545` is a fourth dependency of a different kind — without it the
account cascade deletes the request row itself and the job's `done` write silently matches nothing.
R-8 (§4) carries the same note as a checklist line.

```bash
supabase db push                           # the RPC exists …
supabase functions deploy erasure-job      # … before anything calls it
```

The window is small on a release where both steps run back to back, and it is not small if the
migration ships in one release and the function deploy is forgotten until the next. `deploy:check`
will not catch it: the function is present, just stale, and staleness is reported rather than
gated (§4.3).

---

### 4.5 Auth mail templates — installed by hand, per project (#625)

`supabase/templates/` is the source of truth for the two auth mails this product can send, but
nothing in the repo installs them. GoTrue holds one template per type **per project**, so each of
staging and production needs both pasted in by hand, and a template edited in a PR changes nothing
a member receives until someone does.

| Template slot (Dashboard → Authentication → Emails) | Subject                                       | Body                                   |
| --------------------------------------------------- | --------------------------------------------- | -------------------------------------- |
| Confirm signup                                      | `Conferma la tua email e accendi la tua Aura` | `supabase/templates/confirmation.html` |
| Magic Link                                          | `Il tuo varco per Athanor`                    | `supabase/templates/magic_link.html`   |

Both are also declared in `supabase/config.toml` under `[auth.email.template.*]`. That block is
read only by a local stack, which only CI runs (the `db` job spins one up per push) — **do not
install them with `supabase config push`.** `config push` sends the whole `[auth.email]` block to whatever
`supabase/.temp/linked-project.json` points at, and that block carries `enable_confirmations =
false`, which would turn staging's confirmations **off** as a side effect (staging has them on;
production runs `mailer_autoconfirm = true` and sends no confirmation mail at all — §P1.6 of
`PRODUCTION-READINESS.md`, #70).

Two consequences for the confirmation mail specifically: its live audience today is **staging
only**, and it stays that way until #70's reversal sequence runs, which needs a domain with
DKIM/SPF first (#471). Neither project has an SMTP provider, so both are on Supabase's built-in
mailer at 2 mails/hour — enough for a manual check, not for a cohort.

`supabase/functions/_shared/mail-templates.test.ts` gates the repo side of this (every declared
template resolves, is Italian, carries the GoTrue variable its flow needs, and has the subject
pinned in the guard's own table). It cannot see the hosted projects, so it will stay green while both dashboards
hold the stock English defaults. Verify by sending yourself one of each after installing.

---

### 4.6 Migration ORDER when a client schema REQUIRES a column (#694)

`profileSchema` and `personProfileSchema` require the keys `birth_date` and `zodiac_sign`
(`.nullable()`, not optional), and `getPublicProfileByHandle` selects `zodiac_sign` off
`profiles`. A build or a web deploy that carries that schema against a database without
`20260905165133` fails **every** sign-in (`get_own_profile` → ZodError, non-retryable in
`profile-read.ts`) and every `/@handle` render (42703). So:

**Rule: apply the migrations to production first, build and deploy second** — the mirror image
of §4.4, and for the same reason: the side that starts depending on the other must land last.
Check `supabase/.temp/linked-project.json` reads `athanor` (production) before the push, and
verify with `select column_name from information_schema.columns where table_name = 'profiles'
and column_name in ('birth_date', 'zodiac_sign')` returning two rows before tagging.

### 4.7 Ticket refunds and disputes are DESTINATION charges now (#104, ruling 2026-09-06) — and the fund rail, which is not

> **⛔ BLOCKING on production only — Connect is not signed up for there (found 2026-09-06 while shipping #104; resolved on the test account the same day, see the closing note).**
> Invoking `create-payout-onboarding` against **staging** with a real organiser JWT returns 500, and the
> function log carries Stripe's reason verbatim:
>
> > `You can only create new accounts if you've signed up for Connect, which you can do at https://dashboard.stripe.com/connect.`
> > — `accounts.create`, `req_Ha8fVQKCd3RRsI`, staging, 2026-09-06
>
> This is **Dashboard state, not repo state**, and it is pre-existing rather than new: until #104 nothing
> in `apps/` or `packages/` invoked that function, so it had never been called and the condition had
> never surfaced. It was recorded as unverifiable in #104's issue check on the same day.
>
> The consequence is total for paid events, and it chains: no Connect → `accounts.create` fails → no
> `payout_accounts` row can ever reach `payouts_enabled` → `has_payouts_enabled` is false for everyone →
> **`create_event` refuses every paid event with 55000**, and `create-ticket-checkout` refuses every
> purchase with 403. Free events, RSVPs, Circle, Identity and the fund rail are all untouched.
>
> **Sign up for Connect on the staging account first and re-walk the CTA there, then on production
> before the release that carries #104.** The fund rail's payout path (#247) has the same dependency and
> the same blocker, so this unblocks both. Nothing in the repo can detect or work around it — treat a
> green CI and a green pgTAP run as saying nothing about this.
>
> Stripe also returns an advisory on every `accounts.create`: _"We recommend building your integration
> using Accounts v2."_ The current shape uses v1 controller properties, which is correct and supported;
> migrating is a separate decision, not a launch item.
>
> **RESOLVED on the test account, later the same day; still unverified on live (2026-09-07).** Connect
> was signed up for and `create-payout-onboarding` now succeeds: staging's `payout_accounts` carries two
> real rows written at 17:01 and 17:31 on 2026-09-06, both with `capabilities.transfers = active`, and a
> ticket Session carrying `payment_intent_data.transfer_data` mints without error. The blocker above
> therefore applies to **production only**, which has no key on this machine and cannot be checked from
> here — re-walk the organiser CTA against live before the release that carries #104.

Since #104 a ticket Checkout Session carries `payment_intent_data.transfer_data.destination` (the
organiser's connected account) and `payment_intent_data.application_fee_amount` (Athanor's
`events.fee_pct`, default 10%). Stripe splits the money at payment time. Nothing in this repo
initiates a refund — there is no `refunds.create` anywhere — so refunds stay **Dashboard-issued**,
and that is exactly why this section exists: the Dashboard's defaults are wrong for this charge
shape, and getting them wrong costs real money in a direction nobody notices for a month.

**Read this before refunding a ticket.**

#### What Stripe does by default, and why it is wrong here

> "When refunding a charge that has a `transfer_data[destination]`, by default the destination
> account keeps the funds that were transferred to it, leaving the platform account to cover the
> negative balance from the refund."
> — docs.stripe.com/connect/destination-charges, "Issue refunds"

So a plain refund of a €15 ticket takes €15 out of Athanor's balance and leaves €13,50 sitting with
the organiser. Athanor eats the whole ticket, not its commission.

#### The two flags

| flag                     | default | what to use, and why                                                                                                                                                                                                                                                                                                  |
| ------------------------ | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `reverse_transfer`       | `false` | **Always `true` for a ticket.** Pulls the organiser's share back to cover the refund. A full refund reverses the whole transfer; a partial refund reverses proportionally. Without it Athanor funds the organiser's refund out of its own balance.                                                                    |
| `refund_application_fee` | `false` | **Leave `false`** unless the refund is Athanor's fault (a platform outage, a duplicate charge we caused). `false` keeps the commission on a sale that was made and then unwound; `true` hands it to the organiser. Either way the buyer is made whole — this flag only moves money between Athanor and the organiser. |

Stripe's own constraint, worth knowing before the Dashboard argues with you: _"If you refund the
application fee for a destination charge, you must also reverse the transfer."_ `refund_application_fee: true` without `reverse_transfer: true` is rejected.

In the Dashboard the two appear as checkboxes on the refund dialog for a Connect charge. If they
are not offered, the charge is not a destination charge — stop and find out why before refunding.

Neither flag returns Stripe's **processing fee**, which is not refunded on a refund. Athanor is out
that amount on every refunded ticket regardless of the flags, because the platform is the one that
paid it (`controller.fees.payer: 'application'` on these accounts).

#### Disputes

> "For destination charges, with or without `on_behalf_of`, Stripe debits dispute amounts and fees
> from your platform account."

The organiser is not touched automatically. Recovering their share is a **manual transfer
reversal**, from the Dashboard's Transfers view or the transfer-reversal API. If the dispute is
later won, transferring the money back to the organiser needs Athanor's balance to cover it.

There is no dispute-recovery automation and no `charge.dispute.created` arm that reverses a
transfer. W12 revokes the buyer's ticket; the money side is an operator act. **If ticket volume
makes that unsustainable, that is a new issue, not a thing to improvise during an incident.**

#### One more asymmetry worth knowing

For delayed payment methods (SEPA), if the destination account loses its `transfers` capability
between authorisation and settlement, Stripe **skips the transfer** and the funds stay in Athanor's
balance, signalled by `charge.updated` with a null `transfer_data`. Nothing here listens for that
today. The ticket is issued and the organiser is not paid, and only a balance reconciliation would
show it.

#### Contribution refunds (fund rail) — refund the GIFT, never the coverage (FUND-51, #236, #711)

A fund contribution is Athanor's own charge, not a destination charge: the two flags above do not
apply and the Dashboard will not offer them. What the operator has to get right instead is the
**amount**, and nothing in code checks it. `reverseContribution` (`stripe-webhook/handlers.ts`,
shared by W4 `charge.refunded` and W12 `charge.dispute.created`) flips the row to `refunded` whole
and un-counts `amount_cents` from the public ticker; it reads neither `amount_refunded` nor the
partial/full distinction. The ticker therefore stays exact in the two cases the code was written
for — the gift alone, or the entire charge — and **understates the pool on any smaller partial**:
refund €5 of a €25 gift and the whole €25 leaves the public total. The payer's money is entirely
what you type into the refund dialog.

**Refund exactly `fund_contributions.amount_cents` — the gift — as a partial refund.** Never the
charge total. The payer consented to that line before ticking the box
(`fund.disclose.coverage.notReturned`: «Se un giorno ti viene rimborsato il contributo, la copertura
non torna indietro»), and Stripe does not return its processing fee on a refund, so returning the
coverage would cost the fund money it never held.

How to read the figures without arithmetic: an uncovered contribution is a single line item
(«Dai Vita al Tuo Sogno — contributo») and `amount_cents` equals the charge; a covered one is
**two line items** on the Checkout Session — «Dai Vita al Tuo Sogno — contributo» and «Dai Vita al
Tuo Sogno — copertura costi di pagamento» — and the
Session's metadata carries `gift_cents` and `coverage_cents` as strings. The row's `charged_cents`
is the generated sum and equals Stripe's `amount_total`. Refund the first line item's amount. The
only case that refunds the whole charge is a duplicate or a platform fault, and then the coverage
goes back too because the charge itself should never have happened.

`apps/native/src/lib/fund-disclosure.test.ts` pins the consent line outside the tick conditional,
so it cannot silently become visible only after consent. This step exists because the promise
lives here and nowhere in code — #711 item 6 found the copy present and the procedure absent.

### 4.8 Payment-method coverage — what a buyer is shown, and how each rail is proved (2026-09-07)

Nothing in this repo selects payment methods. `create-ticket-checkout`, `create-contribution-session`
and `create-circle-checkout` pass neither `payment_method_types` nor `payment_method_configuration` —
`supabase/functions/stripe-webhook/handlers.ts` says so at `assertSettled`. The **Stripe Dashboard's
payment-method configuration is the only control**, it is account state rather than repo state, and no
test in CI can see it. A green pipeline says nothing about which rails a member can pay with.

It is worse than a single unseen switch, because the enabled set is not the offered set. Stripe filters
per Session by currency, by mode, and by charge shape, and every filter is silent:

```
pnpm payments offers
```

mints one throwaway Session per surface with its builder's shape, reads back the
`payment_method_types` Stripe computed, and expires it. As of 2026-09-07, test mode:

| surface             | Session shape                          | what the buyer is shown |
| ------------------- | -------------------------------------- | ----------------------- |
| fund contribution   | `mode: payment`, EUR                   | card, Link, **PayPal**  |
| Circle              | `mode: subscription`, EUR              | card, Link, **PayPal**  |
| event ticket (#104) | `mode: payment` + `transfer_data`, EUR | card, Link — no PayPal  |

Two things that table is the only way to learn:

- **PayPal is silently absent on ticket purchases.** PayPal's Connect support is _"Partial — requires
  manual approval"_, so Stripe drops it from any Session carrying `payment_intent_data.transfer_data`.
  Nothing errors; the button is simply not drawn. Ask Stripe for Connect approval or accept the gap,
  but do not discover it from a member's mail.
- **Apple Pay and Google Pay never appear in `payment_method_types`.** They ride `card` and surface per
  device. Their absence from the list is not a defect and their presence cannot be inferred from it —
  the only proof is `payment_method_details.card.wallet.type` on the charge after a real wallet tap,
  which `pnpm payments check` prints.

The enabled set was narrowed on 2026-09-07 to card, Link, PayPal, Apple Pay and Google Pay; BLIK,
Bancontact and EPS were disabled and giropay is retired by Stripe. Two entries read differently
depending on where you look: the Dashboard lists **Cartes Bancaires** and **Stripe balance
(preview)** as enabled, while the payment-method configuration reports `cartes_bancaires` and
`customer_balance` with a literal `preference: off` — not an unset default. The mechanism behind
that disagreement is **unverified**; do not write a reason for it here until someone has one. What
is settled is which list to trust: `pnpm payments offers` asks Stripe per Session, so it answers
what a buyer is shown, and neither entry appears in any surface's `payment_method_types`.

#### Every offered rail is inside the settlement standard

`assertSettled` fulfils on `checkout.session.completed` and throws on anything that is not already
`paid` or `no_payment_required`, so
the whole design rests on every reachable method being an **immediate-notification** one. Verified
against each method's Stripe documentation on 2026-09-07:

| method             | notification  | refunds     | disputes |
| ------------------ | ------------- | ----------- | -------- |
| card               | immediate     | yes         | yes      |
| Apple / Google Pay | = card        | yes         | yes      |
| Link               | immediate     | yes         | yes      |
| PayPal             | **immediate** | yes (180 d) | yes      |

Bancontact and EPS were verified immediate too (refundable 730 and 180 days, neither disputable) and
Bancontact was walked successfully on a test Payment Link before both were disabled — recorded here
because if either is ever re-enabled, that evidence still stands.

> **Correction, 2026-09-07 — BLIK is not a delayed-notification rail.** An earlier revision of this
> section and of `assertSettled`'s docblock listed it as one, inherited from that docblock's original
> delayed-rail list. Stripe's Dashboard reports BLIK's payment confirmation as **Immediate**, and no
> Stripe documentation classifies it as delayed. It was disabled anyway, along with Bancontact and
> EPS, so nothing turns on it — but the claim was wrong and had been repeated in four places. All
> four are corrected in the same change: `assertSettled`'s delayed list, `supabase/ENV-NOTES.md`,
> `docs/PRODUCTION-READINESS.md`'s binding pre-deploy list, and issue #71, whose title was the claim
> and which is closed as retracted. giropay is not merely disabled: the account offers no toggle for
> it at all, Stripe having dropped it after the service was discontinued in 2024.

No delayed rail reaches a buyer, so the fail-closed guard is dormant. One standing condition on that:

- **The live-mode configuration is a separate object and has not been checked.** Test and live payment
  methods are configured independently, so nothing above is evidence about live. `pnpm payments` cannot
  answer this one: every command in it dies on any key that is not `sk_test_`, because even `offers`
  _mints_ a Checkout Session before reading the method list back. The single exception is
  `pnpm payments endpoints` (§4.2), which only reads. Read the live
  configuration in the Dashboard instead (Settings → Payment methods), and re-derive the per-surface
  filtering by hand from the two rules that do the filtering: **subscription mode drops every bank
  redirect** (Bancontact, EPS and the rest are unsupported in Checkout subscription mode, and in
  Subscriptions generally except `send_invoice`), and **a destination charge drops PayPal**. Both
  matter when reading a live configuration that may still have bank redirects enabled. Per §4.2 no live-mode endpoint exists yet, so this is a step in opening payments,
  not a check that is overdue.

#### Proving a rail, one at a time

A drawn button proves nothing. Three things fail independently — Stripe's `payment_status`, the
`stripe_webhook_events` row's `processed_at`, and the row the handler was supposed to write — and a
rail is verified only when all three hold. Test-mode webhooks already point at staging, so the loop is
real end to end.

```
pnpm payments accounts                                     # the connected account for --dest
pnpm payments mint contribution --profile <uuid> --edition <uuid> --amount 500
pnpm payments mint ticket --profile <uuid> --event <uuid> --dest acct_…
pnpm payments mint circle --profile <uuid> --price price_…
# pay the printed URL in a browser, then
pnpm payments check cs_test_…
```

`mint` carries the real `metadata.kind` / `metadata.profile_id`, so the webhook treats the payment as
genuine and writes to staging. That is the point — a probe that skips the webhook proves only that
Stripe works.

| rail           | what to do at Checkout                                                                                                                                                  | needs          |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| card           | `4242 4242 4242 4242`, any future expiry and CVC                                                                                                                        | —              |
| card + 3DS     | `4000 0025 0000 3155`, complete the challenge                                                                                                                           | —              |
| card declined  | `4000 0000 0000 0002` — assert **no** row is written                                                                                                                    | —              |
| Link           | any email and phone; test-mode verification code `000000`                                                                                                               | —              |
| PayPal         | test mode redirects to a Stripe-hosted simulator, not real PayPal — authorise there                                                                                     | —              |
| **Apple Pay**  | Safari on iPhone or Mac with a real card in Wallet. Test mode does not charge it. Hosted Checkout runs on Stripe's domain, so there is no Apple Pay domain to register. | an iPhone      |
| **Google Pay** | Chrome signed into a Google account with any card                                                                                                                       | desktop Chrome |

**Mint a Checkout Session, never a Payment Link.** A Payment Link renders PayPal, Link and the two
wallets as express-checkout buttons, and those do not survive automated clicking — a walk driven from
a browser tool stalls there and reads as a broken rail. Hosted Checkout renders PayPal as a full-page
redirect — the same full-page shape that let Bancontact be walked successfully on 2026-09-07,
before it was disabled. `pnpm payments mint` produces the right one.

Run each rail on each surface that offers it — 3 for contributions, 3 for Circle, 2 for tickets. Pass
means `payment_status: paid`, a ledger row for this Session with `processed_at` not null, and the
target row present (`fund_contributions` / `event_tickets` / `circle_memberships`). Two out of three
is a failure, and which two tells you where to look.

Read the ledger read carefully, because its two failure shapes have different causes. A row present
with `processed_at` **NULL** means the handler threw — §4.1's alarm, and the event is queryable and
retrying. **No row at all** has two causes, both outside the code: either Stripe never delivered the
event (endpoint missing, disabled, or scoped wrong — §4.2 has the inventory), or it delivered and the
signature check refused it, which answers 400 and returns _before_ the ledger write, so nothing is
recorded. A wrong or unset `STRIPE_WEBHOOK_SECRET` is the second one, and §4.2 records it as
production's deliberate interim state — so at cutover it is the likelier of the two. Check the
endpoint's recent deliveries in the Dashboard: a 400 there distinguishes them immediately. Only these
can look identical to "the rail does not work" while the rail is fine.

#### The three tests beyond the happy path

- **Refund** — `stripe refunds create --payment-intent pi_…` fires `charge.refunded`. For a ticket read
  §4.7 first: the flags are not the Dashboard's defaults.
- **Dispute** — pay with `4000 0000 0000 0259` to fire `charge.dispute.created`. Card only; PayPal
  disputes cannot be simulated in test mode.
- **The fail-closed alarm, once.** Enable SEPA in the **test** Dashboard, pay with it, and confirm the
  webhook answers 500 with `processed_at` left NULL — that is `assertSettled` working. Then disable it
  and replay the event. Do not leave it enabled: sustained 5xx makes Stripe disable the endpoint, which
  also kills `charge.refunded` and `charge.dispute.created`, and §4.1 explains why that turns a loud
  guard into a silent over-count of the public fund ticker.

## 5. Apple IAP / Stripe Compliance Posture (S-IAP-1 … S-IAP-4)

Spec ref: `10-m10-launch.md` §7.

| ID      | Surface                                                                                                                                                                                                                                                                                                                                                              | Posture                           | Status                                                                                                                                                                                                                                            |
| ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S-IAP-1 | **Athanor Circle subscription (M8)** — Apple Guideline 3.1.1 requires auto-renewable IAP for digital subscriptions consumed in-app. M8 ships Stripe Billing (Android/web). iOS requires Apple IAP (StoreKit) or the subscribe CTA must not appear on iOS.                                                                                                            | `✅ posture (hide) / ⬜ StoreKit` | **Compliance-by-hiding SHIPPED** (`26d5260`, PRODUCTION-READINESS P0): subscribe+manage CTAs absent on iOS. Submission-safe. Only the actual StoreKit wiring remains a genuine follow-up (PRODUCTION-READINESS P5 `circle.tsx:151` `iap` branch). |
| S-IAP-2 | **Dream Fund contributions (M7)** — one-off donation to a pooled fund. iOS: external Stripe Checkout web sheet via `expo-web-browser` / Safari (external purchase link, not an in-app Payment Sheet). Also gated by the `fund_surfaces_enabled` client flag (default OFF) plus the `fund_editions.contributions_enabled` legal gate. Android: Stripe direct allowed. | `🔁 verify`                       | Verify on iOS: contribute CTA opens `WebBrowser.openAuthSessionAsync` to the Stripe Checkout URL, never an in-app Payment Sheet. Confirm `fund_surfaces_enabled = false` in `remote_config` until counsel clears.                                 |
| S-IAP-3 | **Event tickets (M4)** — tickets for physical/real-world events are generally exempt from Apple IAP (real-world goods exception). Verify each ticket type's classification with App Review guidance. Stripe Checkout acceptable for real-world event tickets.                                                                                                        | `🔁 verify`                       | Confirm ticket types qualify as real-world goods. If any ticket grants access to purely digital content, Apple IAP may be required.                                                                                                               |
| S-IAP-4 | **Stripe Identity verification (M9)** — not a purchase; no IAP concern. Keys server-side only (CLAUDE.md #6 — the app never holds a Stripe secret; it opens a backend-created session URL).                                                                                                                                                                          | `✅ posture`                      | No IAP issue. Verify server-side key handling holds in the release build (R-1 grep).                                                                                                                                                              |

> **Invariant (CLAUDE.md #6):** the app never holds a Stripe secret key. All Stripe calls go through backend edge functions that create session URLs; the app only opens those URLs. Verify this holds in the R-1 bundle grep.

> **Webhook endpoint API version (2026-08-07):** `STRIPE_API_VERSION` is pinned to `2026-05-27.dahlia` (`supabase/functions/_shared/stripe.ts`, aligned with the pinned `npm:stripe@22` SDK). When creating the Dashboard webhook endpoint at deploy time (§4.2), set the endpoint's API version to exactly this value — a mismatch changes event payload shapes under the signature check.

> **Payout transfer deploy config (2026-08-16, #247):** the Dashboard webhook endpoint's enabled events must also include **`transfer.created`** and **`transfer.reversed`** (the W14/W15 arms are the ONLY writers of `fund_payout_ledger`; without the events, releases move real money that the ledger — and therefore `close_cycle`'s disbursed figure — never sees, rule 6's cache silently goes stale). `release-fund-payout` deploys with the normal function release; it needs no secrets beyond the platform-injected ones.

> **Settle sweep deploy config (2026-08-16, #248):** the `fund-settle-sweep` `pg_cron` job (daily 04:41 UTC) calls `invoke_fund_settle_sweep()`, which resolves its target through `athanor.runtime_setting` and **no-ops quietly until the operator creates the Vault pair** on the project: `select vault.create_secret('https://<ref>.supabase.co/functions/v1/release-fund-payout', 'app.settings.release_fund_payout_url')` and `select vault.create_secret('sb_secret_…', 'app.settings.release_fund_payout_key')` — NOT `alter database … set`, which fails 42501 hosted; same pattern as the four pairs in `20260810103721`. The migration can therefore land **before** the secrets exist with no cron error-looping — create them whenever the payout rail goes live. Note the sweep is an inert skeleton until #228/#229 (tranche schema) and #231 (verification gate) land: it posts `{"mode":"sweep"}` and `release-fund-payout` answers zero due tranches by construction.

> **Story-segment bytes reaper deploy config (2026-08-21, #31):** the nightly `prune-expired-story-segments` `pg_cron` job (03:17 UTC) now calls `prune_expired_story_segments()`, which soft-deletes the expired rows as before and then posts — exception-guarded, so it can never roll the prune back — to the `story-segment-reaper` edge function via `invoke_story_segment_reaper()`. Deploy the function and create the Vault pair on the project: `select vault.create_secret('https://<ref>.supabase.co/functions/v1/story-segment-reaper', 'app.settings.story_segment_reaper_url')` and `select vault.create_secret('sb_secret_…', 'app.settings.story_segment_reaper_key')` — NOT `alter database … set` (42501 hosted); same pattern as the settle sweep above. Until both exist the job keeps doing exactly what it did before (rows only) with no error loop; once they exist it frees the bytes of every segment hidden for over an hour, ≤ 5 batches of ≤ 1000 per pass through the Storage API (never a `storage.objects` row delete — that orphans the file), sized to answer inside pg_net's 30 s. **Verify** within ~6 h of a pass — pg_net purges `net._http_response` after its ttl, and the table is shared with every other caller, so never read its newest row: `select id, created, status_code, timed_out, content from net._http_response where content like '%"reaped"%' or timed_out order by id desc limit 3` → expect `200 {"reaped":N,"unremoved":0,"rounds":R,"exhausted":true}`; or fire `select public.invoke_story_segment_reaper();` by hand and run the same query a few seconds later. `select * from public.story_segment_reap_candidates(1000)` is empty only right after a pass — anything expired more than an hour ago legitimately reappears until the next one. A populated bucket on first deploy drains ≤ 5000 objects a night (`exhausted:false` until done): a backlog, not a failure. Both hosted projects have the pair now — staging created it 2026-08-21, production 2026-08-24 (#492), and `pnpm deploy:check` reports no Vault-name difference between the two (2026-08-26). What stays useful here is the recipe for a NEW project, not an outstanding item.

> **Post-media bytes reaper deploy config (2026-08-28, #589):** a NEW `pg_cron` job, `reap-post-media-bytes` (daily 04:29 UTC), calls `invoke_post_media_reaper()`. It frees the bytes `publish_post` deliberately leaves behind — objects in `post-media` that no `post_media` row references from `storage_path` **or** `thumb_path`: a previous set's tail positions, the old key at a position whose kind changed (poster included), and the bytes of a draft the member abandoned after the upload but before the write. Deploy the function and create the Vault pair on the project: `select vault.create_secret('https://<ref>.supabase.co/functions/v1/post-media-reaper', 'app.settings.post_media_reaper_url')` and `select vault.create_secret('sb_secret_…', 'app.settings.post_media_reaper_key')` — NOT `alter database … set` (42501 hosted); same pattern as the story-segment reaper above. Until both exist the job is a quiet no-op with no error loop. A soft-deleted post keeps its rows and therefore its bytes, on purpose — freeing those is a separate, irreversible decision, and `refresh-staging.sql` revives seeded posts in place without re-uploading. **Verify** within ~6 h of a pass, and never by reading `net._http_response`'s newest row (the table is shared with every other caller and pg_net purges it after its ttl): `select id, created, status_code, timed_out, content from net._http_response where content like '%"reaped"%' or timed_out order by id desc limit 3` → expect `200 {"reaped":N,"unremoved":0,"rounds":R,"exhausted":true}`; or fire `select public.invoke_post_media_reaper();` by hand and run the same query a few seconds later. `select * from public.post_media_reap_candidates(1000)` is empty only right after a pass. A populated bucket on first deploy drains ≤ 5000 objects a night (`exhausted:false` until done): a backlog, not a failure. **Both projects carry the function and the pair** — `pnpm deploy:check` on 2026-09-09 read production with both; staging's pair was created the same day (key copied inside Vault from the story-segment pair, no value left the database) and a hand-fired `invoke_post_media_reaper()` there answered `200 {"reaped":0,"unremoved":0,"rounds":1,"exhausted":true}`. The first hand-invocation on staging reaped 2 objects (15 MB) of the 7 in that bucket, which is the defect this closes, measured.

> **Erasure job schedule + deploy config (2026-09-08, #107):** a NEW `pg_cron` job, `erasure-nightly` (daily 03:47 UTC), calls `invoke_erasure_job()`. It is the job that finally fulfils an Article 17 request end to end — pseudonymise the retained payment rows, release the references that made the account undeletable, purge the waitlist, delete the account — and a clean pass ends `done` rather than `partial`. Order matters and it is the reverse of the usual one (§4.4): **push the migrations first**, because the job calls three RPCs that migrations create (`gdpr_storage_footprint`, `gdpr_erase_payment_footprint`, `gdpr_release_profile_references`) and a project missing one answers `PGRST202` **after** the fund transaction has already run. Then deploy the function, then create the Vault pair: `select vault.create_secret('https://<ref>.supabase.co/functions/v1/erasure-job', 'app.settings.erasure_job_url')` and `select vault.create_secret('sb_secret_…', 'app.settings.erasure_job_key')` — NOT `alter database … set` (42501 hosted); same pattern as the reapers above. Until both secrets exist the wrapper is a quiet no-op with no error loop, so the migration can land ahead of the rider. **Verify** by firing `select public.invoke_erasure_job();` by hand and reading the response a few seconds later — never the newest row of `net._http_response`, which is shared with every other caller and purged after its ttl: `select id, created, status_code, timed_out, content from net._http_response where content like '%"kvPurge"%' or timed_out order by id desc limit 3` → expect `200 {"seen":N,"kvPurge":{"configured":true,…},"storageRemoved":M}`. `configured:false` there is the one thing to act on, and since #107's review it is worse than it reads: it means the `CF_KV_*` trio (§7.2) is missing on that project, so every request with a handle lands `failed` **and its account is deliberately not deleted**. A degraded pass erases nobody. The job blocks the delete on ANY step having left something behind — a missing KV trio, an unexhausted storage sweep, a failed session revoke, an unreadable auth row — because the storage and KV sweeps both key on the member's uid and the account delete SET NULLs that uid off the request row, so deleting after a failed sweep destroys the only handle that could ever find the residue. Read the response's `retained` counter, not just the 200: non-zero means members are still here on purpose. **Both projects carry all three: staging since 2026-09-08, production since 2026-09-09** (release PR #727 — the smoke there answered `200 {"seen":0,"kvPurge":{"configured":true,"deleted":0,"failed":0},"retained":0,"storageRemoved":0}`, and R-8 flipped on it).

> **Retention reaper (2026-09-09, #715):** a second NEW `pg_cron` job, `gdpr-retention-reap` (daily 04:53 UTC, `20260909085841`), and unlike every reaper above it is **pure SQL** — it calls `public.gdpr_retention_reap()` directly, so there is no edge function to deploy, no `app.settings.*` Vault pair to create, and nothing to rotate. Pushing the migration is the whole rider. It is the second half of the controller's 2026-09-07 ruling (#184): erasure pseudonymises the payment rows and keeps them ten years (art. 2220 c.c.; DPR 600/1973 art. 22), and this drops them when that obligation expires. The window lives in exactly one place, `public.gdpr_retention_window()`, and changing it means a new migration. **The first date on which anything can age out is 2036-08-15** — production's oldest erasure ran 2026-08-15 — so until then a pass deletes nothing on either project and `select * from public.gdpr_retention_reap();` returns three zero counts. That is the expected result, not a failure. **Verify with the read-only probe, never by calling the reaper** — `gdpr_retention_reap()` mutates, and using a deleting function as a health check is how a probe becomes an incident: `select 'fund_contributions' t, count(*) from public.fund_contributions where profile_id = public.gdpr_tombstone_profile_id() and erased_at < now() - public.gdpr_retention_window() union all select 'event_tickets', count(*) from public.event_tickets where erased_at < now() - public.gdpr_retention_window() and user_id is null union all select 'circle_memberships', count(*) from public.circle_memberships where erased_at < now() - public.gdpr_retention_window() and profile_id is null;` → three zeros until 2036. Confirm the job is armed separately with `select jobname, schedule from cron.job where jobname = 'gdpr-retention-reap';` → one row, `53 4 * * *`. Nothing persists a per-pass record: the counts are the function's return value, so when the job first does real work, capture them from a manual run rather than expecting an audit row (the repo's other reapers log nothing either). Two things to know before the decade turns: the job also carries the deleted cents into `fund_editions.reaped_cents` so `recompute_fund_aggregate` keeps the historic `raised_cents` whole, and deleting a reaped `event_tickets` row cascades its `event_attendance` check-in away by design (`supabase/tests/0150_gdpr_retention_reaper.test.sql` §6 asserts both). Nothing here is gated on the erasure rider above: if the Vault pair is never created, nothing is ever pseudonymised, and the reaper correctly finds nothing to reap.

> **Moderation queue alert deploy config (2026-08-31, #602):** a NEW `pg_cron` job, `report-queue-alert-sweep` (every 15 minutes), calls `public.report_queue_alert_sweep()`. Unlike the three riders above it needs **no edge-function deploy and no new Vault pair** — it reuses `athanor.enqueue_notification`, so the only secrets it touches are `app.settings.notification_fanout_url` / `_key`, which both projects already carry (§7.2; re-confirmed on production 2026-08-31, both present). Nothing to run at release. The one prerequisite is not a secret but an account: the sweep derives its recipients from `auth.users.raw_app_meta_data->>'role' = 'admin'`, so **an admin with a `profiles` row must exist on the project** — production has exactly one and it does have a profile (checked 2026-08-31). What that account did NOT have on the same date is a push token: `push_enabled = true` but zero rows in `push_tokens`, and `push-dispatch` treats zero tokens as a silent no-op. Until Marco signs into the app on a device as the admin account, the alert lands as an in-app notification row and the phone stays quiet — which is the half of #602's acceptance line that no migration can deliver. **Verify** after the first release that carries this migration: `select jobname, schedule from cron.job where jobname = 'report-queue-alert-sweep'` returns one row, then file a report on production and check `select count(*) from public.notifications where type = 'reportQueue'` within a quarter hour. A second unresolved report does NOT produce a second notification unless it arrives after the first was announced — the sweep is keyed on `athanor.report_alert_sends`, one row per (report, watcher), so a re-announcement is a bug and a silent quarter hour on an already-announced queue is the design.

> **Payout onboarding deploy config (2026-08-15, #246; corrected 2026-09-06, #702):** `account.updated` must be enabled on a webhook endpoint whose **scope** is «Connected accounts», not merely enabled somewhere. Enabling it on the «Your account» endpoint achieves nothing at all: a connected account's v1 `account.updated` is delivered only to a Connect-scoped endpoint, so the W13 arm that maintains `payout_accounts` never runs, the capability flags never flip, and #247's transfer gate never opens. That is what this rider said for three weeks and what actually happened — staging had the event enabled and had never received one. So: a **second** Dashboard endpoint per project, scope «Connected accounts», pointing at the same `/functions/v1/stripe-webhook` URL, with its own signing secret in `STRIPE_CONNECT_WEBHOOK_SECRET` (§4.2's scope table). And `create-payout-onboarding` needs two edge-function secrets before it answers anything but `payout onboarding not configured`: `PAYOUT_ONBOARDING_RETURN_URL` and `PAYOUT_ONBOARDING_REFRESH_URL` — **HTTPS URLs**, not `athanor://` deep links; Stripe Account Links reject non-HTTPS in live mode, which is why these are env-configured instead of riding `APP_DEEPLINK_BASE`. Connect must be enabled on the Stripe account (Express platform profile) — Dashboard state, not repo state.

> **Stripe https return pages (2026-08-18, #418):** the pages those two URLs point at now exist — `apps/web` serves `/app/payout/return`, `/app/payout/refresh` and `/app/verify`, each forwarding to the `athanor://` scheme. Three edge-function secrets go with them, and **all three must be set only after `apps/web` is live in production**, i.e. after the `dev → main` release that carries those routes — set earlier, Stripe redirects members to a 404. Values: `PAYOUT_ONBOARDING_RETURN_URL=https://www.athanor.world/app/payout/return`, `PAYOUT_ONBOARDING_REFRESH_URL=https://www.athanor.world/app/payout/refresh`, and `IDENTITY_RETURN_BASE=https://www.athanor.world/app/` (a **base**, trailing slash included — `create-verification-session` appends `verify?status=complete`). `IDENTITY_RETURN_BASE` is optional: unset, Identity simply sends no `return_url`, which is what shipped in #417 and costs nothing (webhook W9 carries the flip). Do **not** repoint `APP_DEEPLINK_BASE` at the https base to achieve the same thing — four Checkout-based functions read it and need the `athanor://` scheme for `openAuthSessionAsync` to close the sheet. **Since #104 the `PAYOUT_ONBOARDING_*` pair is BLOCKING for paid events, not merely pending.** Until #104 no client invoked `create-payout-onboarding` at all, so an unset pair was a dead function nobody could reach; the composer now offers organisers a Connect-your-account CTA, and with either URL unset that CTA returns `payout onboarding not configured` (500) — which means no organiser can ever publish a paid event, because the creation gate requires `payouts_enabled` and only this flow can set it.

---

## 6. `remote_config` Operations

The `remote_config` table (backend `00` §7a) is the team's remote kill-switch surface. The app reads it at boot and on resume (before auth — `anon` can SELECT). Only `service_role` can write; no client insert/update path exists (permission denied, `42501`).

### 6.1 Well-known keys and value shapes

| `key`                   | `value` shape                                  | Example                                  | Backs                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ----------------------- | ---------------------------------------------- | ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `min_app_version`       | `{ "ios": "<semver>", "android": "<semver>" }` | `{ "ios": "1.0.0", "android": "1.0.0" }` | `BootGate` force-update screen (frontend `12` §10.1). App shows a non-dismissible update prompt when the installed version is below the declared minimum.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `maintenance_mode`      | `{ "enabled": <bool>, "eta": <string\|null> }` | `{ "enabled": false, "eta": null }`      | `BootGate` maintenance screen (frontend `12` §10.2). When `enabled = true` the app shows a maintenance screen to all users.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `fund_surfaces_enabled` | `{ "enabled": <bool> }`                        | `{ "enabled": false }`                   | The authoritative legal gate is `fund_editions.contributions_enabled`; this flag is **client visibility only** — the boot-time kill-switch that hides fund surfaces app-wide instantly without a store build. Both the edition column and this flag must be `true` before a contribution surface renders (R-2). Also gates the Settings → **Pagamenti** receipts screen (`(modal)/payments.tsx`, P4.4) — flag OFF keeps the row on its «presto» toast. On flip-ON, smoke the receipts screen: row opens the list, empty state renders, a contribution row appears after a test checkout. Default **OFF** until counsel clears (PRD §4.11).                                                                                          |
| `prime_stelle_enabled`  | `{ "enabled": <bool> }`                        | `{ "enabled": false }`                   | Gates the «Le Prime Stelle» launch card on Home (PS-4, §3.6). Flip ON when the Prime Stelle founding cohort is ready to onboard. Default **OFF** until cohort list is prepared (R-9).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `apple_signin_enabled`  | `{ "enabled": <bool> }`                        | `{ "enabled": false }`                   | Reveals the «Continua con Apple» CTA on `(auth)/welcome.tsx` (#79). Default **OFF**, and there is no row on either project today — an absent key reads `undefined` and the CTA stays hidden, which is the point: the flag exists so that enabling Apple sign-in the day the developer account is approved (#95) is a provider config plus this row, with no app release. **Flip ON only after** the Supabase Apple provider is configured on that same project (Services ID + key) — the flag is environment-blind, so on a project whose provider is off the CTA renders and the round trip can only come back an error. Order: provider first, then this flag on staging, then an Expo Go walk, then the same pair on production. |

> **Value-shape constraint:** the `remote_config_value_shape` CHECK constraint in the DB rejects malformed writes (missing `ios`/`android` keys for `min_app_version`; non-boolean `enabled` for all other keys). A bad service_role write raises `23514` (check_violation) — the constraint protects against fat-fingered kill-switch edits.

> **Last-known-good contract (supersedes the original fail-open contract, 2026-08-07):** every successful `remote_config` fetch persists a zod-validated snapshot on device (`athanor.remote-config.lkg.v1` in AsyncStorage — deliberately not the TanStack persisted cache; it never expires). If the fetch fails (network error, Supabase outage, timeout), `BootGate` enforces that snapshot: a user already flagged for force-update or maintenance cannot dodge the gate by going offline. The gate **fails open only on first-ever install** (no snapshot yet) or when the ~3s boot budget elapses before the snapshot read settles — a Supabase outage must never strand a _new_ user. While resolving, `BootGate` holds a blank view under the brand splash (≤3s); with a snapshot or warm cache present it decides instantly, so the normal launch path gains no latency.

### 6.2 How to flip a flag as service_role

**Via Supabase MCP (in this Claude Code session):**

```
-- upsert a flag value
insert into public.remote_config (key, value)
values ('fund_surfaces_enabled', '{"enabled": true}')
on conflict (key) do update set value = excluded.value;
```

Run this via `mcp__plugin_supabase_supabase__execute_sql` with the hosted project ID (`kwzeiqvrnnaagccyoose`). MCP connections use the service_role credential.

**Via Supabase Dashboard:**

1. Open the hosted project in the Supabase Dashboard (Frankfurt).
2. Navigate to **Table Editor → remote_config**.
3. Find the row by `key` and edit the `value` JSON inline.
4. Save — the change takes effect immediately; clients pick it up within 60 seconds (the `staleTime` window in `useRemoteConfig()`).

**Via psql (service_role):**

```sql
insert into public.remote_config (key, value)
values ('maintenance_mode', '{"enabled": true, "eta": "2026-06-21T20:00:00Z"}')
on conflict (key) do update set value = excluded.value;
```

### 6.3 Seeding initial rows before launch

Before going live, seed the five well-known keys with their default values:

```sql
insert into public.remote_config (key, value) values
  ('min_app_version',           '{"ios": "1.0.0", "android": "1.0.0"}'),
  ('maintenance_mode',          '{"enabled": false, "eta": null}'),
  ('fund_surfaces_enabled',     '{"enabled": false}'),
  ('prime_stelle_enabled',       '{"enabled": false}'),
  ('apple_signin_enabled',      '{"enabled": false}')
on conflict (key) do nothing;
```

Run once as `service_role` on the hosted project before the first EAS submission.

> **The seed files carry four of these five, not all five.** `supabase/seed.sql` and `supabase/staging-seed/seed-staging.sql` deliberately omit `apple_signin_enabled`: the Apple provider is not configured on either project, so a seeded row — even `{"enabled": false}` — would only be a row waiting to be flipped ON before the credential it needs exists. The app needs no row at all to fail closed (an absent key reads `undefined`), so the key is created at enable time by the §6.1 sequence. Do not "fix" the seeds to match this block without configuring the provider first.

### 6.4 Server-side version backstop (edge functions)

The client gate is skippable by definition (a modified or offline client renders anyway), so every client-invoked edge function — the `'user'` posture rows of `supabase/functions/_shared/config-invariants.test.ts`: `check-in`, `create-circle-checkout`, `create-circle-portal`, `create-contribution-session`, `create-payout-onboarding`, `create-ticket-checkout`, `create-verification-session`, `get-circle-prices` at the time of writing; the test is the count — also enforces `min_app_version` server-side (`supabase/functions/_shared/version-gate.ts`):

- Every app request carries `x-app-version` + `x-app-platform` headers (set globally in `apps/native/src/lib/supabase.ts`).
- A build below the platform's `min_app_version` gets **HTTP 426** with body `{ "error": "outdated_client", "minVersion": "<semver>" }`. The app intercepts any 426 from `/functions/v1/` and pins the force-update screen for the process lifetime.
- The gate reads the `min_app_version` row through a per-isolate in-memory cache with a **60s TTL** — a config flip reaches edge enforcement within ~60s, the same window as the client `staleTime`.
- **Fail-open on every doubt** (missing headers, DB error, malformed row): this is a courtesy check against honest-but-outdated clients — headers are client-supplied and trivially forged. Real invariants stay behind RLS and the service-role gates, never behind this.
- **If a bad `min_app_version` write locks users out:** fix the row (§6.2); edge caches expire within 60s, but affected clients keep the force-update screen until app restart.

The internal (service-role) functions and `stripe-webhook` are deliberately not gated. That set is not listed here: it is every `'internal'` and `'webhook'` row of the same posture table, and the six names this line used to carry had fallen to fewer than half of them without anyone noticing (#674).

### 6.5 One-time key rename — DONE (issue #223, D48)

The client flag was renamed `fund_contributions_enabled` → `fund_surfaces_enabled` (2026-08-15): the name now says what it does — client visibility for fund surfaces — instead of implying it is the legal contributions gate (that gate is `fund_editions.contributions_enabled`).

> **✅ Applied. Nothing to run.** Production `remote_config` carries `fund_surfaces_enabled` and no `fund_contributions_enabled` row — queried on both projects 2026-09-07 (Management API). This section said the opposite for some weeks, and R-2 carried a matching ⚠; both were stale, and an operator following them at release would have run a no-op `UPDATE` against a key that no longer exists. Kept as the record of what was done, not as a pending step.

The statement this section prescribed, for the record — a state query proves the end state, not the route to it:

```sql
update public.remote_config
set key = 'fund_surfaces_enabled'
where key = 'fund_contributions_enabled';
```

`UPDATE` rather than delete+insert: `created_at` is preserved and the touch trigger stamps `updated_at` with the rename. Before it ran, app builds carrying the rename found no `fund_surfaces_enabled` row and failed closed (fund surfaces hidden) — which is why it was safe to leave pending. Production's row reads `{"enabled": false}` today; the flag stays OFF until counsel clears (PRD §4.11), and that is a separate decision from the rename.

- **Prime Stelle launch:** insert/flip the `prime_stelle_enabled` row in hosted `remote_config` to `{"enabled": true}` (§6.2) when the founding cohort is ready — `seed.sql` is local-only; a missing row fail-closes (card hidden).
- **Founding cohort:** grant badges via service-role SQL — `update public.profiles set founding_member = true where id in (…);` — cosmetic only, zero Aura; clients cannot write the column.

---

## 7. Deferred Items

These items are **explicitly out of scope for Fase 1** and must not be conflated with items that are code-ready.

### 7.1 Prime Stelle — founding cohort feature (✅ SHIPPED flag-gated, P4.2 2026-07-07)

The **feature is built**: the «Le Prime Stelle» Home card (`PrimeStelleCard`), the `FoundingBadge` on Profilo, the `profiles.founding_member` backend flag, the referral/invite deep-link cohort tag (P4.1), and the `prime_stelle_enabled` flag gate — all shipped in production-readiness P4.1/P4.2. The `prime.*` i18n keys (6) are consumed by the card/badge. Remaining work is **ops only**: prepare the cohort list, run the cohort SQL, flip the flag (§6.2).

Rules that must hold at launch (verified in the shipped code):

- `prime.note` renders next to the CTA (zero score advantage — CLAUDE.md #1).
- `prime.badge` is cosmetic, never a lit star, never feeds `aura_events` (rule #1, pgTAP "client cannot write score" stays green).
- Flip `prime_stelle_enabled` to `{ "enabled": true }` in `remote_config` via §6.2 when the cohort is ready.

### 7.2 Other deferred items (M10 spec §11)

| Item                                                                                                                                                                                                                                                                                                                                      | Deferred to                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Local Circles full feature (city chapters, local board, Tempo Bank economy)                                                                                                                                                                                                                                                               | Fase 2 (`11-fase2-beyond.md`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Light theme, RTL layouts, locales beyond IT/EN                                                                                                                                                                                                                                                                                            | Not planned for Fase 1                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Apple IAP integration for Circle on iOS (StoreKit wiring)                                                                                                                                                                                                                                                                                 | M8 follow-up (S-IAP-1 — CTA-hide compliance already shipped `26d5260`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Annual fund going live (contributions)                                                                                                                                                                                                                                                                                                    | Behind the `fund_editions.contributions_enabled` legal gate and the `fund_surfaces_enabled` client flag until counsel clears (PRD §4.11)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Sentry `@sentry/react-native` installation and PII `beforeSend`                                                                                                                                                                                                                                                                           | ✅ CODED (P1.4, 2026-07-08) — consent-gated init + PII scrub; remaining = DSN/org secrets + crash-free gate (B-3)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `gdpr-export-job` + `erasure-job` edge-function deploy                                                                                                                                                                                                                                                                                    | ✅ DEPLOYED — verified on production 2026-08-26 by `pnpm deploy:check` (§4.3), v8 and v10 ACTIVE (v6 and v6 when the 2026-08-22 check first measured this row; #540 moved `erasure-job` since). The row read "M9 deploy-deferred" until the check measured it.                                                                                                                                                                                                                                                                                                                                                              |
| Notification fan-out edge-function deploy                                                                                                                                                                                                                                                                                                 | ✅ DEPLOYED — verified on production 2026-08-22 by `pnpm deploy:check` (§4.3), v5 ACTIVE, and both `app.settings.notification_fanout_url` + `notification_fanout_key` Vault secrets exist on production. ⚠ **M5 Momento coupling stands:** `on_momento_proposal_push` routes through `enqueue_notification` (in-app row → push), so Momento pushes need fan-out deployed **and** those secrets **in addition to** `push_dispatch_url/_key` — configuring push-dispatch alone silently drops them. Create a Vault secret with `select vault.create_secret(…)`, never `alter database … set` (42501 on a hosted project).     |
| `story-segment-reaper` edge-function deploy                                                                                                                                                                                                                                                                                               | ✅ DEPLOYED — verified on production 2026-08-26 by `pnpm deploy:check` (§4.3), v2 ACTIVE, and both `app.settings.story_segment_reaper_url` + `_key` Vault secrets exist on production. The row read "production MISSING" from the 2026-08-22 check until the 2026-08-24 deploy (#492); the nightly `prune-expired-story-segments` cron reaps expired bytes there now.                                                                                                                                                                                                                                                       |
| `post-media-reaper` edge-function deploy                                                                                                                                                                                                                                                                                                  | ✅ DEPLOYED — `pnpm deploy:check` on 2026-09-09 reads the function on both projects (staging v5, production v2) and the `app.settings.post_media_reaper_url` + `_key` pair on both; staging's pair was created that day and a hand-fire answered `200 … "exhausted":true`. The row read "STAGING ONLY" from 2026-08-28 (#589) until then; the first staging hand-invocation reaped 2 orphaned objects (15 MB). See the deploy rider in §5.                                                                                                                                                                                  |
| Stripe Identity + `create-verification-session` edge-function deploy                                                                                                                                                                                                                                                                      | ✅ DEPLOYED — verified on production 2026-08-22 by `pnpm deploy:check` (§4.3), v6 ACTIVE.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| **Waitlist retention purge** — schedule `athanor.purge_email_waitlist()` via `pg_cron` as `service_role` (e.g. `select cron.schedule('purge-waitlist','0 4 * * *', $$select athanor.purge_email_waitlist()$$);`). Drops aged + already-registered emails; function exists, only the schedule is missing.                                  | Deploy-time (GDPR retention for the pre-launch `email_waitlist`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| **`erasure-job` KV purge credentials** — set `CF_KV_PURGE_TOKEN` (Workers KV Storage:Edit only), `CF_KV_ACCOUNT_ID` and `CF_KV_NAMESPACE_ID` on **both** hosted projects (`supabase secrets set --env-file ./supabase/.env --project-ref <ref>`); the namespace is `wrangler.jsonc`'s `preview_id` on staging and its `id` on production. | ✅ SET — verified 2026-08-26 against the Management API: all three names present on both hosted projects, and `erasure-job` is deployed to production (v10, `pnpm deploy:check` §4.3). The row read "Deploy-time, blocking" until 2026-08-24 (#515, #540). Keep the failure mode in view, because it is what a rotated-away secret restores: every erasure request for a member with a handle terminates `failed` and is never re-queued (the claim query filters `status='requested'`), even though its DB cascade succeeded — and the member's prerendered page and OG card stay readable by key. §7.4 has the mechanism. |
| Post-launch growth analytics / cohort dashboards                                                                                                                                                                                                                                                                                          | Fase 2 ops                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |

### 7.3 Web deploy-time items (recorded 2026-08-08)

Surfaced by the apps/web import verification (item 13 code work landed the same day: web now
prefers `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, legacy anon as fallback).

| Item                                                                                                             | Action at deploy                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `<TEAMID>` / `<SHA256>` placeholders in `apps/web/app/api/well-known/*` + `TODO(P1.5)` in `apps/native/eas.json` | Fill with the real Apple Team ID and the Android keystore SHA-256 (`eas credentials`). Until then iOS association fails silently and Android `autoVerify` fails.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Supabase publishable key                                                                                         | Fetch `sb_publishable_…` (Dashboard → Settings → API Keys); set as CI repo secret `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, and local `apps/web/.env.local`. Only after web + a native build carry it may "Disable legacy API keys" be clicked; then remove the anon fallback arm from both resolvers + `.env.example`s + the CI gate.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Supabase auth redirect allow-list (production)                                                                   | `additional_redirect_urls` must include the web `/admin/auth/callback` (locally covered by `site_url` only).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Cloudflare Workers setup                                                                                         | ✅ **DONE 2026-08-10, re-provisioned 2026-09-03 in the Anecoica Studio account** (`info.anecoica@gmail.com`; the original `contact.marco.accardi@gmail.com` account is decommissioned — Cloudflare cannot move a Worker or a KV namespace between accounts, so everything below was recreated from source). Account `dd4f02a5be2749d785f6910b7d565fd9`, workers.dev subdomain `athanor` (redirect origin only), Worker `www`, custom domains `www.athanor.world` + `athanor.world` (declared as `routes` in `apps/web/wrangler.jsonc`, created by `wrangler deploy`), KV namespaces `NEXT_INC_CACHE_KV` = `def1ea339846492495056d9feaf39d0d` / `_preview` = `1a49e77416244f3ca28a746a0bf31e01` (committed in `wrangler.jsonc` — not secrets; the deploy job asserts both exist in the deploying account). Repo secrets: `CLOUDFLARE_API_TOKEN` (scoped Workers Scripts:Edit + Workers KV Storage:Edit + Account Settings:Read), `CLOUDFLARE_ACCOUNT_ID`, `NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_CF_BEACON_TOKEN` (the last is public — it ships in the page HTML). Web Analytics site configured for `www.athanor.world`. The deploy job runs on push to `main` behind every gate in its `needs:` and ends with a `/BUILD_ID` probe against `NEXT_PUBLIC_SITE_URL` that polls for propagation, because a read at T+0 can still serve the previous build (#681). The `erasure-job` credentials in §7.2 (`CF_KV_*`, both Supabase projects) name the same account and namespaces and were re-set with them. |
| Site origin                                                                                                      | ✅ **DONE 2026-08-10 on `www.athanor.workers.dev`; moved 2026-09-03 to `https://www.athanor.world`** (#471 — registered at Cloudflare Registrar in the Anecoica Studio account, zone on Full (strict) + Always Use HTTPS). Swapped atomically across `apps/web/lib/site.ts`, `apps/web/next.config.ts` (every other host 308s to it; `/.well-known/*` exempt), `.env.example` ×3, `apps/native/app.json`, `apps/native/src/lib/links.ts`, and `EXPO_PUBLIC_SITE_ORIGIN` on all three EAS environments (#486). Supabase Auth on both projects: Site URL = the new origin, `https://www.athanor.world/admin/auth/callback` in the allow-list. No store build ever carried the old host, so no resubmission is owed; the first iOS build compiles the new one in.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Waitlist hardening                                                                                               | ✅ **DONE in code** (issue #23, 2026-08-09). Per-address throttle is a BEFORE INSERT trigger on `email_waitlist` (5 per 10 min, keyed on the `x-forwarded-for` the route forwards onto the Supabase client); over the cap raises `PT429` and the route answers 429. The per-signup Resend email was **removed**, not capped — one send per non-duplicate address meant a fresh address each time mailbombed the inbox, so the Resend-sandbox-sender item is moot and `RESEND_API_KEY`/`WAITLIST_TO` are gone from `apps/web`. Read signups at `/admin/waitlist`. Remaining ops: a Cloudflare rate-limiting rule in front is still worth adding (available on the free plan) (the header is client-supplied, so this is a cost control, not an authorization boundary), and a digest job if push notification of signups is wanted back.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Native OAuth signups drop referral codes (`apps/native/src/app/(auth)/welcome.tsx` OAuth arm)                    | Known nuance — product decision pending; web invite landing implies redemption always happens.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |

### 7.4 Moderation between web releases — the per-handle OG card (#440)

A ban takes effect in the database immediately, but `apps/web` only reaches production at a
`dev → main` release. Between those two moments the banned member's Open Graph card can still
unfurl in WhatsApp, Slack or a tweet with their photo and dream quote, even though `/@handle`
already 404s. This section says how long that lasts and how to cut it short.

**How long it lasts: until the next `apps/web` deploy — not forever.** Measured against the
production KV namespace on 2026-08-18, not inferred from the docs:

- Every incremental-cache key is `incremental-cache/<BUILD_ID>/<sha256(path)>.cache`, and
  `BUILD_ID` is Next's per-build nanoid (no `generateBuildId` in `apps/web/next.config.ts`), so
  it rotates on every build. The deployed value is public at `https://www.athanor.world/BUILD_ID`.
- `opennextjs-cloudflare`'s `populate-cache` only ever `kv bulk put`s the _current_ build's
  assets. It never lists and never deletes, so a deploy neither clears nor overwrites what is
  already there.
- Since PR #439, `generateStaticParams` reads through the anon client, so a banned handle is
  absent from the next build's params. Its old entry is therefore stranded under a dead build
  prefix — unreachable — and the live prefix has no key for it. The request misses, takes the
  blocking fallback, and hits the Worker branch in `app/[handle]/opengraph-image.tsx`, which
  redirects to the generic site-wide card.
- Since #335, `generateStaticParams` is **capped** to the `PRERENDER_HANDLE_LIMIT` most recently
  updated handles and the next `PRERENDER_EVENT_LIMIT` events (`apps/web/lib/prerender-limits.ts`,
  with the KV-write arithmetic). A member outside that set has no prerendered card at all — their
  og:image is the generic site card on every request, not only until the next deploy — and their
  page renders on first hit, then caches for five minutes at a time. Editing the profile moves
  it back into the set at the next build. The `web build` CI job asserts the caps against the
  manifest (`pnpm --filter web test:prerender`).

So the release cadence is the bound. **A redeploy of `apps/web` is the ordinary fix** and needs no
key arithmetic — it is the same action as a release.

**To cut a single card without a release**, delete its one key. `/@handle` here is the URL path,
including the `@`:

```bash
BUILD_ID=$(curl -s https://www.athanor.world/BUILD_ID)
HASH=$(printf '%s' "/@handle/opengraph-image" | shasum -a 256 | cut -d' ' -f1)
cd apps/web && pnpm exec wrangler kv key delete \
  --namespace-id def1ea339846492495056d9feaf39d0d --remote \
  "incremental-cache/$BUILD_ID/$HASH.cache"
```

The next request for that path re-renders on demand, hits the Worker branch, and gets the generic
card. Use `--namespace-id`, not `--binding`: the binding carries both an `id` and a `preview_id`
and wrangler refuses the ambiguity (see the note in `apps/web/wrangler.jsonc`).

⚠ **Neither path erases the bytes.** Deleting the live key or rotating the build only makes the
entry unroutable; the KV cache writes no TTL and nothing sweeps old prefixes, so the stranded PNG
and page HTML stay readable _by key_ indefinitely. Measured before any sweep existed: on
2026-08-18 the production namespace held 132 keys across **four** build prefixes — only one live
— and an orphan from a dead prefix still returned the full prerendered profile page for a handle
that no longer exists in the production database at all. That measurement is what the erasure
sweep below was built for. The sweep is deployed and credentialed on production now (2026-08-24,
#515), so a _processed_ erasure purges those keys — and since #107 the job is **scheduled**
(`erasure-nightly`, 03:47 UTC, `20260908071807`), so on a project that has run the §5 rider a
request is processed within a day rather than never. On a project that has not, the wrapper
no-ops and a request nobody has run leaves the residue exactly as before. Nothing expires a key
either way: outside a processed erasure the
only thing that clears a dead prefix is the manual sweep in this section, so the inventory
otherwise only grows. Two consequences:

- **Erasure (#107, R-8) is not satisfied by a redeploy.** A GDPR erasure that clears the database
  leaves this residue behind, so the erasure cascade sweeps the namespace by prefix rather than
  deleting one live key — `supabase/functions/erasure-job/kv.ts` (#515). It lists
  `incremental-cache/` once and deletes every key whose hash matches `/@handle` or
  `/@handle/opengraph-image`, under **every** build prefix, live and dead. It needs
  `CF_KV_PURGE_TOKEN` (a token scoped to **Workers KV Storage:Edit** only — narrower than the
  deploy's `CLOUDFLARE_API_TOKEN` above), `CF_KV_ACCOUNT_ID`, and `CF_KV_NAMESPACE_ID` (the
  production `id` on production, the `preview_id` on staging, so a staging erasure cannot sweep
  the production cache) in the function's env on **both** hosted projects. Without them the job
  leaves the bytes in place and records the request `failed` — for a subject who has a handle; a
  handle-less member has no public URL and still lands on `partial` — and the response reports
  `kvPurge.configured: false` even on a run that saw no requests, so one smoke invocation
  catches an unconfigured deploy. See §7.2 for the provisioning step.
- **Orphans accumulate per deploy** and count against the free plan's 1 GB. It is small today —
  the four observed prefixes run 17 to 46 keys — because production carries few public profiles,
  but each per-handle card is ~78 KB and every deploy writes a fresh copy of every one of them, so
  the growth is `profiles × deploys`. #335 tracks the scale seam.

To sweep dead prefixes by hand, list the namespace, keep the prefix matching the live `BUILD_ID`,
and `wrangler kv bulk delete` the rest.

---

### 7.5 Reconciling pre-#107 erasure requests (R-8)

Every request filed before #107 stopped short of the account delete and recorded that as
`partial` (or, before #515, as `failed`). Nothing re-queues a TERMINAL row: since #717 the claim
predicate reaches `requested` and stale `processing`, and neither `partial` nor `failed` is
either. The rows are therefore unfinished obligations that look finished, and each project has to
be reconciled by hand ONCE, after that project has the migrations, the function deploy and the
Vault pair (§5).

**A row stuck on `processing` is NOT one of these, and does not belong in the re-queue below.**
Since #717 the job claims it back on its own: `claim_erasure_requests` takes every `processing`
row whose `claimed_at` is older than the lease — or absent, which is what a row stranded before
that migration looks like — so the nightly pass picks it up without help. Flipping such a row to
`requested` by hand is worse than leaving it: it hands the same member two open rows, and the
claim then serves only one of them per pass anyway. Step 1 lists them so you can see they are
draining, and step 5 says what to do if one is not.

Every step of the job is safe to re-drive: the DB reach is idempotent by construction, the account
delete cannot run twice because it SET NULLs the request's own subject, and the Stripe cancel
reads the subscription's status before touching it (#717). So re-driving a terminal request is
just flipping it back:

```sql
-- 1. What is outstanding on this project, whose account still exists, and — for a row the job
--    is meant to be recovering on its own — whether its lease has actually run out.
--    `lease` reads: 'terminal' the row needs step 2; 'held' a pass is running it right now,
--    leave it alone; 'reclaimable' the next pass will take it back, do nothing.
select r.id, r.status, r.created_at, r.claimed_at,
       (p.id is not null) as account_still_exists,
       case
         when r.status <> 'processing' then 'terminal'
         when r.claimed_at is null then 'reclaimable (no stamp — stranded before #717)'
         when r.claimed_at < now() - interval '15 minutes' then 'reclaimable (lease expired)'
         else 'held (a pass is running)'
       end as lease
  from public.gdpr_erasure_requests r
  left join public.profiles p on p.id = r.profile_id
 where r.status in ('partial', 'failed', 'processing')
 order by r.created_at;

-- 2. Re-queue them — the OLDEST terminal row per member, never all of them. Since #107 a
--    partial unique index allows one 'requested' row per member
--    (gdpr_erasure_requests_one_open_per_profile), so a blanket UPDATE over two terminal rows
--    sharing a profile_id aborts the whole statement with 23505. Rows whose subject is already
--    NULL are re-queued freely: NULLs are distinct, and the loop marks them done without work.
update public.gdpr_erasure_requests r
   set status = 'requested'
 where r.status in ('partial', 'failed')
   and (
     r.profile_id is null
     or not exists (
       select 1 from public.gdpr_erasure_requests other
        where other.profile_id = r.profile_id
          and other.status in ('partial', 'failed')
          and (other.created_at, other.id) < (r.created_at, r.id)
     )
   );

-- 3. Drive a pass now rather than waiting for 03:47.
select public.invoke_erasure_job();

-- 4. A few seconds later: every row should read 'done', with profile_id NULL. Repeat steps 2-4
--    while step 1 still lists anything: one pass re-queues one row per member, so a member with
--    several historical rows takes several passes.
--    A row back on 'failed' is a real failure — read the function logs before re-driving it,
--    because re-queueing a genuinely failing request just loops it nightly.
select status, count(*), count(*) filter (where profile_id is null) as identity_dropped
  from public.gdpr_erasure_requests
 group by status;

-- 5. ONLY if step 1 shows a 'processing' row still 'held' after the isolate is known to be dead
--    — a deploy mid-pass, a project paused, function logs that stop mid-cascade. RELEASING the
--    lease is nulling the stamp: the claim predicate treats a 'processing' row with no
--    claimed_at as infinitely stale, so the very next pass takes it.
--
--    Do NOT reach for `claim_erasure_requests(20, interval '0')` here. It would re-stamp the
--    rows with a FRESH claimed_at, and the job invoked in step 3 asks for the default
--    15-minute lease — so the rows you just "released" are the ones it skips, and step 1 goes
--    back to reading 'held' with nothing running. The zero lease belongs to the pgTAP tests,
--    which pass their own interval on purpose.
--
--    And do not run this while a pass may still be live: handing a running isolate's rows to a
--    second one is the double-drive the lease exists to prevent. Waiting the lease out costs
--    15 minutes and needs no judgement.
update public.gdpr_erasure_requests
   set claimed_at = null
 where status = 'processing'
   and id = '<the id from step 1>';
-- Then step 3 again. The pass claims the row, stamps it fresh, and drives it.
```

One symptom worth naming, because it looks like this section's problem and is not: **every**
request sitting on `processing`, re-claimed nightly, never reaching a terminal status, with
`erasure-job: lease lost before the terminal write` in the function logs on every pass. That is not
a stranded queue — it is the lease FENCE rejecting its own writes. The loop fences its terminal
update on the `claimed_at` the claim handed back (#717), so if that value ever stopped surviving
the round trip out of `claim_erasure_requests` and back in as a filter, no request could ever leave
`processing` and the nightly pass would re-drive each one for ever. Releasing the lease will not
help and neither will re-queueing; the fix is in the code, not here. Verified working on staging on
2026-09-08 — a request seeded in the stranded shape was claimed, driven, and written to `done`
through the fence — so this is a regression to recognise, not a state to expect.

Two things to know before running it:

- **A `partial` row whose account no longer exists is already reconciled by the schema.**
  `20260908073545` made `profile_id` `ON DELETE SET NULL`, so a NULL there means the account is
  gone. Re-queueing such a row is safe: the loop recognises a request with no subject and marks it
  `done` without touching a single port (`erasure-job/logic.ts`, and `logic.test.ts` pins it).
  Without that branch the null would have reached GoTrue, errored, and landed the row back on
  `failed` — this procedure would have turned stalled rows into nightly looping ones. `done` there
  means «nothing left to do», not «work performed».
- **Never run step 2 against production before the §5 rider exists on production.** Without the
  Vault pair `invoke_erasure_job()` no-ops, and you will have moved a set of rows from a status
  that says «stopped short» to one that says «waiting», with nothing coming to serve them.

Staging was reconciled on 2026-09-08 in the #107 lane: two requests, both `done`, both with the
identity dropped. Production is **not** reconciled — it runs at the release that carries #107.

---

### 7.6 Stranded and failed export jobs (#721)

`gdpr-export-job` claimed its batch the way `erasure-job` did before #717 — a SELECT on
`status = 'requested'` followed by an UPDATE predicated on the row id alone, with nothing
re-checking the row was still `requested` — so a pass torn down mid-run left
its rows on `processing` with nothing to re-queue them, and the member's archive never arrived.
Since #721 the batch is taken by `claim_export_jobs` under a 15-minute lease, and a job that
cannot be served is filed `failed` rather than looped.

Two facts shape everything below. **`failed` is terminal and the member's to undo** — the claim
predicate does not reach it; the member is notified (`notif.tpl.gdprExportFailed`, routed to the
export screen) and that screen shows «Non siamo riusciti a preparare il tuo archivio. Richiedilo di
nuovo.» with the ordinary request button, which files a NEW row. And **a
job older than 30 days minus the 72h signed-link TTL cannot be served at all**: `expires_at <=
created_at + interval '30 days'` leaves no room for the link, so the loop files those `failed`
before building anything. That is the fence which stops the lease turning a stranded job into one
rebuilt and rejected every night.

Both projects held **zero** `gdpr_export_jobs` rows on 2026-09-08, so nothing needs reconciling
today; this section is what to do when that stops being true.

```sql
-- 1. The queue, and which 'processing' rows are actually held. A row whose lease is live belongs
--    to a pass that may still be running; a stale one is the next claim's, with no action needed.
select status,
       count(*) as n,
       count(*) filter (where status = 'processing'
                        and claimed_at >= now() - interval '15 minutes') as lease_live,
       count(*) filter (where status = 'processing'
                        and (claimed_at is null or claimed_at < now() - interval '15 minutes'))
         as reclaimable,
       count(*) filter (where status = 'ready' and download_url is null) as ready_without_url,
       min(created_at) as oldest
  from public.gdpr_export_jobs
 group by status
 order by status;

-- 2. `ready` WITH NO URL is the pre-#721 signing failure: the loop wrote 'ready' whatever
--    createSignedUrl returned, so the #129 producer told the member their archive was ready and
--    the screen then showed them no link, on a terminal row. The code no longer produces it (a
--    signing failure requeues). File any legacy row 'failed' so the member is asked to try again.
--
--    THIS NOTIFIES. The producer's failed arm (20260908155128) fires per row this statement
--    touches, so each affected member gets «Non siamo riusciti a preparare il tuo archivio» —
--    which is the point, but do it deliberately and not at 03:00.
update public.gdpr_export_jobs
   set status = 'failed'
 where status = 'ready'
   and download_url is null;

-- 3. Drive a pass now rather than waiting for 03:25. There is no invoke_export_job() wrapper —
--    gdpr-export-nightly is operator-created — so READ THE JOB'S OWN COMMAND and run that, rather
--    than trusting the paste below: a hand-created job can carry a baked-in header instead of a
--    Vault lookup (20260808074301:18-20), and the two projects need not agree.
select command from cron.job where jobname = 'gdpr-export-nightly';

--    On both projects on 2026-09-08 that command was the Vault-resolving form, which is what the
--    snippet below reproduces. `athanor.edge_auth_headers` presents the secret on `apikey`, the
--    one header the platform will not try to parse as a JWT.
select net.http_post(
  url := 'https://<project-ref>.supabase.co/functions/v1/gdpr-export-job',
  headers := athanor.edge_auth_headers(athanor.runtime_setting('notification_fanout_key')),
  body := '{}'::jsonb,
  timeout_milliseconds := 5000) as request_id;

-- 4. READ THE RESPONSE. pg_net is fire-and-forget: `net.http_post` returns a request id whatever
--    happens next, so a 401 looks exactly like a pass. If the Vault name is missing or rotated,
--    `athanor.runtime_setting` returns NULL, edge_auth_headers builds null header values, and the
--    function refuses — with nothing to see here. This is the only thing that tells the two apart.
select status_code, content
  from net._http_response
 where id = <the request_id from step 3>;
--    A pass answers 200 with {"processed":N,"failed":M}.

-- 5. A few seconds later, step 1 again. One pass claims at most CLAIM_BATCH (10) jobs, so a
--    backlog takes several — and each one re-stamps the rows it takes, so an immediate second
--    invocation claims NOTHING until those leases lapse. Wait the 15 minutes, or use step 6 for a
--    row you know is dead.
--    A row on 'failed' is not a queue to drain — it is terminal and the member has been told, so
--    there is nothing to re-drive; what it is worth is reading the logs to learn WHY. Only the
--    servable window files 'failed'; «section read failed, archive withheld and requeued»,
--    «upload failed, requeued» and «signing returned no url, requeued» all leave the job on
--    'requested' for the next pass, and a job that keeps hitting one of those is the thing that
--    eventually ages out into 'failed'.

-- 6. ONLY if step 1 shows a 'processing' row still held after the isolate is known to be dead —
--    a deploy mid-pass, a project paused, function logs that stop mid-run. RELEASING the lease is
--    nulling the stamp: the claim predicate treats a 'processing' row with no claimed_at as
--    infinitely stale, so the very next pass takes it.
--
--    Do NOT reach for `claim_export_jobs(10, interval '0')` here. It would re-stamp the rows with
--    a FRESH claimed_at, and the pass invoked in step 3 asks for the default 15-minute lease —
--    so the rows you just "released" are the ones it skips. The zero lease belongs to the pgTAP
--    tests, which pass their own interval on purpose.
--
--    And do not run this while a pass may still be live: two isolates uploading one archive is
--    harmless (the upload upserts on {profile_id}/{job.id}.json), but the second one's 'ready'
--    write is fenced out and logs «lease lost before the status write», which then looks like a
--    fault. Waiting the lease out costs 15 minutes and needs no judgement.
update public.gdpr_export_jobs
   set claimed_at = null
 where status = 'processing'
   and id = '<the id from step 1>';
-- Then steps 3-4 again.
```

One symptom worth naming, because it looks like this section's problem and is not: **every** job
re-claimed nightly, never reaching a terminal status, with `gdpr-export-job: lease lost before the
status write` in the function logs on every pass. That is not a stranded queue — it is the lease
FENCE rejecting its own writes, the same regression shape §7.5 records for erasure. Every status
write fences on the `claimed_at` the claim handed back, so if that value ever stopped surviving the
round trip out of `claim_export_jobs` and back in as a filter, no job could leave `processing`.
Releasing leases will not help; the fix is in the code, not here.

## 8. Acceptance Gates (G1–G7)

Full gate definitions live in `10-m10-launch.md` §10. Summary for go/no-go sign-off:

| Gate | Requirement                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Backed by           |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| G1   | i18n parity + voice: IT/EN parity green for all namespaces incl. `store.*` / `prime.*`; interpolation + plural audited; zero hardcoded strings; no «engagement/utenti/notifica»; locale switch QA passes; RTL-N/A recorded.                                                                                                                                                                                                                                                                                           | I-1…I-9             |
| G2   | WCAG 2.1 AA: every interactive target ≥44pt; 2px aura focus rings; every meaningful ✦/glyph labeled; contrast meets Foundation §13 ratios; SR order + focus-trap correct; Dynamic Type + reduced-motion verified per screen; VoiceOver and TalkBack critical-path smoke pass; reaction counts author-only to SR.                                                                                                                                                                                                      | A-1…A-9             |
| G3   | Performance budgets: cold start <3s p75; feed p75 <1s on 4G; FlashList everywhere; media lazy-loaded + cached; bundle within budget; Reanimated on UI thread; Hermes on; `expo-updates` OTA strategy configured; no leaked subscriptions.                                                                                                                                                                                                                                                                             | P-1…P-10            |
| G4   | Beta live and healthy: TestFlight + Play internal track distributing EAS builds; Sentry capturing symbolized crashes; analytics opt-in, first-party, post-consent, no third-party trackers; feedback loop running; Maestro happy path green; crash-free ≥ 99.5% before widening rollout.                                                                                                                                                                                                                              | B-1…B-8             |
| G5   | Store-ready: icon/splash at `#0A0A1A` ✅; localized IT+EN screenshots + copy (`store.*` ✅); privacy/Data-Safety forms match reality; honest age rating; IAP compliance verified (Circle = Apple IAP or no iOS CTA; Fund = external web checkout on iOS behind legal flag); `expo-doctor` clean; deep links resolve through auth gate; push entitlements present.                                                                                                                                                     | S-1…S-11, S-IAP-1…4 |
| G6   | Prime Stelle ready (feature shipped flag-gated in P4.2; this gate = cohort ops): founding invite resolves via deep link + tags cohort; cosmetic founding badge renders (no Aura effect — pgTAP still green); launch card behind flag; copy states zero score advantage.                                                                                                                                                                                                                                               | PS-1…PS-5           |
| G7   | Runbook executable: secrets in EAS/vaults (no secret in bundle ✅ posture); feature flags (`fund_surfaces_enabled` OFF, `prime_stelle_enabled` OFF) toggleable without a store build ✅; rollback path rehearsed; Sentry monitoring + alerts live; version footer reads app config ✅; all CI gates + `athanor-reviewer` green on release diff; Supabase EU region ✅ + GDPR export/erasure ✅ (both edge functions deployed); `pnpm deploy:check` green (§4.3) — no repo edge function undeployed on either project. | R-1…R-9             |

---

## 9. Fund cycle 1 — operator runbook (D41)

D41: screening, declaration and the announcement transitions ship as **service-role edge
functions first**; the admin panel comes later, so cycle 1 is operated from here. Every call
below is a POST with the `sb_secret_…` key on the **`apikey`** header (never `Authorization` —
the platform would parse it as a JWT), against `https://<ref>.supabase.co/functions/v1/<fn>`.
Each function's SQL transition is atomic and refuses (4xx, no write) rather than half-applying;
a 502 is a failure to investigate, not a refusal. Zero Aura from any of these (rule #1).

### 9.1 Screening (#218)

`screen-candidacy` — body `{ "candidacyId": "<uuid>", "decision": "start|pass|reject|reopen", "reasons": ["<code>"] }`
(`reasons` only with `reject`, codes from `screening_criteria`). Refused once the ballot opens (D4).

### 9.2 Ballot close → announcement (#219, #220)

Run **after `voting_ends_at` has passed**, in this order:

1. **`announce-cycle`** with `{ "editionId": "<uuid>", "op": "enter" }` — the two-part
   shortfall gate. Response `outcome`:
   - `announced` — the pool is snapshotted into `confirmed_pool_cents` (the figure the winner
     confirms viability at; it never changes afterwards). Contributions keep flowing (D34).
   - `voided_quorum` / `voided_underfunded` — the cycle is **closed** with that published
     reason, candidacies go terminal `voided`, and there is nothing further to run this
     cycle; the pool carries into the successor at #221's rollover. Stop here.
2. **`declare-winner`** with `{ "editionId": "<uuid>" }` — writes the winner from the tally
   (D7 tie order). Legal before or after step 1; its own quorum/floor refusals cannot fire
   once step 1 announced.
3. **The winner's viability decision** — relay it with `announce-cycle`,
   `op: "confirm"` or `op: "decline"`, once the winner has answered against the
   `confirmed_pool_cents` figure (FUND-42: deliverable at that amount, or not):
   - `confirm` → `winner_confirmed_at` is stamped; realization planning proceeds (#228/#229).
   - `decline` → the cycle closes `voided_declined`, the whole field (winner included) goes
     `voided`, **no runner-up is promoted** — a re-submission in the successor cycle is the
     member's explicit choice. The confirmation is the point of no return: a recorded
     `confirm` cannot be followed by a decline (withdrawing later is #221's failure path).

Every transition writes an `audit_log` row (`announce`, `void_cycle`, `winner_confirm`,
`winner_decline`, `declare_winner`, `screen_*`, `publish_plan`) — the §20 report reads from
there.

### 9.2b The realization plan — the winner's act, not the operator's (#229)

**There is no operator step here, and that is the design.** After the confirmation, the
winner writes the plan themselves in the app (Fondo → «Il tuo piano»): objective, expected
result, professionals, suppliers, and the phases — each a date, an amount and the criteria
its verification is judged against. Every phase amount is costed against
`confirmed_pool_cents` less the declared `split_pct`, and the database refuses a plan that
sums past it (`phases exceed declared payable`). The budget the candidacy asked for has no
bearing on this figure.

The winner then **publishes** it (`publish_realization_plan()`, called from the app). That
one transaction stamps `published_at`, makes the plan world-readable, writes the
`publish_plan` audit row — and **moves the cycle from `announcement` to `realization`**. So:

- A cycle sitting in `announcement` with a confirmed winner has **no published plan yet**.
  That is the state to check before chasing anything else.
- After publication nothing — not the winner, not the operator through the client path — can
  edit the plan. It is the public commitment tranches release against (FUND-53).
- `close-cycle` accepts both `announcement` and `realization`, so §9.3 is unaffected either
  way. Since #231 `release-fund-payout` takes a `planPhaseId` on every call and reads that
  phase, so a cycle with no published plan has no tranche to release — there is no longer
  any payload that releases money without naming a phase.

If the winner is stuck, the failure is theirs to report, not an operator command to run:
there is no service-role plan-authoring path and adding one would put Athanor's words in the
dreamer's plan.

### 9.2c Tranche release — no verification, no money (#231)

Money reaches the winner **one phase at a time**, and only after Athanor has recorded that the
phase met the criteria the winner published. The order is not negotiable and there is no
release-then-reconcile path: FUND-53 («il denaro raccolto dovrà essere utilizzato secondo il
progetto approvato») is an **ex-ante** gate.

1. **`verify-plan-phase`** — `{ "planPhaseId": "<uuid>", "evidence": "<what was delivered,
where it can be seen>" }`. An **admin act with evidence**, the per-phase sibling of §9.3's
   realized declaration — never a community vote, and never the winner: `verified_at` is
   granted to no client, so there is no member path to this, by construction. Refuses
   (no write) for an unknown phase, a plan still in draft, a cycle outside `realization`
   (or `closed`+`realized`), a phase already verified, and missing or oversized evidence.
   Writes the `verify_phase` audit row with the phase, what it unlocks, and your evidence.
2. **`release-fund-payout`** — `{ "editionId": "<uuid>", "planPhaseId": "<uuid>",
"amountCents": N }`. Refuses `phase not verified` until step 1 has run for that phase.
   Bounded twice: by the cycle's settled-minus-released (#244) **and** by the phase's own
   costed `amount_cents` less what already moved against it. The transfer carries the phase
   on its metadata; the `transfer.created` webhook arm records the attribution.

**You usually do not need step 2.** The daily `fund-settle-sweep` cron (04:41 UTC) enumerates
every verified, not-yet-fully-released phase and asks for each phase's remainder. Verifying a
phase is therefore normally the whole operator act — the money follows within a day, or the
sweep's response says why not (its `refusals` tally names each refusal and its count). Call
`release-fund-payout` by hand only to move a **partial** tranche or to pay one out immediately.

A phase can be verified only once. If a verification turns out to be wrong after the fact,
there is no un-verify: the tranche has moved, and the remedy is #221's `realization_failed`
closure, not a rewritten record.

### 9.3 Closure and rollover (#221)

`close-cycle` ends a cycle and opens its successor in **one transaction**. Every call takes a
`successor` object — the next cycle's declarations, chosen now because nothing defaults them
(FUND-SPEC §5): `{ "targetAt": "<ISO>", "goalCents": N, "minFundingCents": N, "minVoters": N,
"minCandidacies": N, "splitPct": N, "costFeeStatement": "…", "equityDeclared": "…" }`. The
successor opens at `candidacy` with both windows shut and `contributions_enabled=false` —
opening them stays a separate operator act. Contributors are refunded in **no** branch; the
carry is `greatest(carried_in + raised − disbursed, 0)`.

- **Realized** — the dream was delivered against its published plan. An admin act with
  evidence, never a second community vote:
  `{ "editionId": "<uuid>", "op": "close", "outcome": "realized", "evidence": "<what was
delivered, where published>", "successor": { … } }`.
  Requires a declared, viability-confirmed winner. Disburses the `confirmed_pool_cents`
  snapshot; the post-snapshot remainder carries into the successor (D34/D35). Candidacy
  statuses stand as the historical record.
- **Realization failed** (D33, post-tranche) — the delivery is declared failed:
  same call with `"outcome": "realization_failed"` and **nothing else** — since #247 the
  disbursed figure is read from `fund_payout_ledger` (released-net, reversals netted),
  never typed by the operator. The payload is strict: a legacy `"releasedCents"` key is
  refused `400 invalid payload` rather than silently ignored. The unreleased remainder
  carries; the candidacy field (winner included) goes terminal `voided`.
- **Rollover after a void** — §9.2's voids already closed the cycle, so only the successor
  remains: `{ "editionId": "<uuid>", "op": "rollover", "successor": { … } }`. The whole pool
  carries. One successor per predecessor — a second call refuses `already rolled over`.

Audit rows: `close_cycle` on the predecessor (evidence + figures), `rollover_cycle` on the
successor. The counter starts at zero either way; `carried_in_cents` renders as its own
distinctly-labelled amount (FUND-45).

---

_Generated for M10 beta-store-submission slice · 2026-06-21_
