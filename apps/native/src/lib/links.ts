/**
 * External destinations (P3.4). URLs/addresses are configuration, not copy —
 * rule #5 (i18n) covers user-facing strings only. The legal pages live on the
 * external marketing site (P1.3).
 *
 * Every destination derives from SITE_ORIGIN. Spell a new one as
 * `${SITE_ORIGIN}/path`, never as its own literal: `links.test.ts` anchors
 * SITE_ORIGIN to the host `app.config.ts` resolves for the same origin, so a
 * derived constant is host-checked for free, while a fresh literal would escape
 * that check until someone remembered to add it to the test's list.
 *
 * That anchor is also what pins the fallback below to `app.json`. With the
 * variable unset `app.config.ts` resolves `app.json`'s own associated domain,
 * so the two literals are compared to each other on every run: editing
 * `app.json`'s host without editing this one fails CI rather than shipping an
 * app that claims one host and hands out links on another.
 *
 * The origin is EXPO_PUBLIC_SITE_ORIGIN (#486). It is the same value
 * `app.config.ts` claims in `associatedDomains` and the Android intent filters,
 * so the URL this app hands out and the domain the binary claims cannot drift —
 * that drift opens the browser instead of the app, silently.
 *
 * A literal member expression, not `process.env[name]`: Metro inlines
 * `EXPO_PUBLIC_*` at bundle time, and the computed form yields `undefined` at
 * runtime with nothing pointing at the cause.
 *
 * The value is concatenated raw, so it has to be a bare origin — no trailing
 * slash, no path. `app.config.ts` rejects anything else at config time, which
 * runs before Metro bundles this file.
 *
 * `||`, not `??`: a cleared EAS environment variable interpolates as the empty
 * string rather than staying unset, and `??` would keep it (same reasoning as
 * `apps/web/lib/site.ts`). Unset falls back to production rather than throwing —
 * there is no staging web host to point at yet (#471), so every build profile
 * resolves here today.
 */
export const SITE_ORIGIN = process.env.EXPO_PUBLIC_SITE_ORIGIN || 'https://www.athanor.workers.dev';

export const LEGAL_TERMS_URL = `${SITE_ORIGIN}/terms`;
export const LEGAL_PRIVACY_URL = `${SITE_ORIGIN}/privacy`;
export const SUPPORT_EMAIL = 'info.anecoica@gmail.com';
export const INVITE_URL_BASE = `${SITE_ORIGIN}/invite`;
