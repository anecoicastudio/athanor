import Constants from 'expo-constants';
import * as Sentry from '@sentry/react-native';
import type { Breadcrumb, ErrorEvent } from '@sentry/react-native';

/**
 * Crash reporting (P1.4 / RUNBOOK B-3, B-5, §3.5.1). Two hard rules:
 *
 *  1. **Consent-gated — deferred init.** NOTHING leaves the device until the user grants the
 *     `analytics` consent (the diagnostics toggle in `(modal)/trust.tsx`). We do NOT init at
 *     module load: `Sentry.init` also emits a release-health *session* envelope and installs
 *     native crash handlers whose envelopes bypass the JS `beforeSend` — so a load-time init
 *     would leak telemetry pre-consent. Instead `SentryConsentGate` calls `initSentry()` the
 *     moment consent is granted and `closeSentry()` when it is revoked / on logout. The
 *     `telemetryConsent` flag + `beforeSend`/`beforeBreadcrumb` gates are kept as belt-and-
 *     suspenders for the JS path (covers the close()-flush window).
 *  2. **PII-scrubbed.** Even post-consent, `scrubEvent` strips identity, auth headers, request
 *     bodies/urls, free-form extra, breadcrumb text, and token-shaped strings (RUNBOOK §3.5.1
 *     denylist: never log chat content, email, profile text, or tokens).
 *
 * Expo Go has no Sentry native module, so init no-ops there — crash reporting is a dev-build /
 * EAS-build feature. DSN comes from `EXPO_PUBLIC_SENTRY_DSN` (public by design); source maps
 * upload with the server-only `SENTRY_AUTH_TOKEN` EAS secret at build time.
 */

const isExpoGo = Constants.executionEnvironment === 'storeClient';
const DSN = process.env.EXPO_PUBLIC_SENTRY_DSN;

// Read at event time by beforeSend/beforeBreadcrumb; flipped by <SentryConsentGate/>.
let telemetryConsent = false;
export function setTelemetryConsent(granted: boolean): void {
  telemetryConsent = granted;
}

// Whether Sentry.init has run — init is deferred to first consent grant (see rule 1).
let initialized = false;

const REDACT = '[redacted]';

// JSON Web Tokens (eyJ…header.payload.sig) and `Bearer …` strings — the shapes most likely
// to carry a Supabase access token if one ever lands in an error message. Opaque refresh
// tokens are NOT matched: they only appear in request bodies (deleted) / headers (redacted).
const TOKEN_RE =
  /eyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}|Bearer\s+[A-Za-z0-9._-]+/g;

export function redactTokens(input: string): string {
  return input.replace(TOKEN_RE, REDACT);
}

/**
 * PII denylist scrub. Pure (mutates + returns the passed event) so it can be reasoned about
 * in isolation. Keeps device/os/app context (needed to triage a crash); drops everything that
 * can carry a person's data.
 */
export function scrubEvent(event: ErrorEvent): ErrorEvent {
  // Identity: no id / email / username / ip_address / geo, and no device name (server_name).
  delete event.user;
  delete event.server_name;

  // Request context can carry auth tokens (headers/url) and posted chat/profile text (data).
  if (event.request) {
    const { headers } = event.request;
    if (headers) {
      for (const key of Object.keys(headers)) {
        if (/^(authorization|cookie|x-.*-key|apikey)$/i.test(key)) headers[key] = REDACT;
      }
    }
    if (event.request.url) event.request.url = redactTokens(event.request.url);
    delete event.request.cookies;
    delete event.request.data;
    delete event.request.query_string;
  }

  // Free-form `extra` is the most common place app data leaks into an event.
  delete event.extra;

  // Redact token-shaped substrings from any human-readable message text.
  if (event.message) event.message = redactTokens(event.message);
  if (event.logentry?.message) event.logentry.message = redactTokens(event.logentry.message);
  for (const value of event.exception?.values ?? []) {
    if (value.value) value.value = redactTokens(value.value);
  }

  // Defense-in-depth: auto-crumbs already pass beforeBreadcrumb at capture, but re-scrub here
  // so a crumb attached by any other path can't trail token text or raw data into the event.
  for (const crumb of event.breadcrumbs ?? []) {
    if (crumb.message) crumb.message = redactTokens(crumb.message);
    const isNetwork =
      crumb.category === 'http' || crumb.category === 'xhr' || crumb.category === 'fetch';
    if (!isNetwork && crumb.data) delete crumb.data;
  }

  return event;
}

function beforeSend(event: ErrorEvent): ErrorEvent | null {
  if (!telemetryConsent) return null; // consent gate — nothing sent until granted
  return scrubEvent(event);
}

function beforeBreadcrumb(crumb: Breadcrumb): Breadcrumb | null {
  if (!telemetryConsent) return null;
  // Console logs frequently echo chat/profile text — never trail them into a crash.
  if (crumb.category === 'console') return null;
  // Redact token-shaped substrings from any crumb message (navigation route, etc.).
  if (crumb.message) crumb.message = redactTokens(crumb.message);
  if (crumb.category === 'http' || crumb.category === 'xhr' || crumb.category === 'fetch') {
    // Network crumb: keep only method + status; drop the URL (query tokens) and any body.
    if (crumb.data) {
      const { method, status_code } = crumb.data as { method?: unknown; status_code?: unknown };
      crumb.data = { method, status_code };
    }
  } else if (crumb.data) {
    // touch / ui / navigation crumb data can carry component labels + route params — drop it.
    delete crumb.data;
  }
  return crumb;
}

/** Install Sentry (idempotent). Called by SentryConsentGate on first consent grant. */
export function initSentry(): void {
  if (initialized || !DSN || isExpoGo) return;
  initialized = true;
  Sentry.init({
    dsn: DSN,
    sendDefaultPii: false, // never attach IP / cookies / default user
    beforeSend,
    beforeBreadcrumb,
  });
}

/** Tear Sentry down when consent is revoked / on logout. */
export function closeSentry(): void {
  if (!initialized) return;
  initialized = false;
  void Sentry.close();
}
