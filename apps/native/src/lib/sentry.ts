import Constants from 'expo-constants';
import * as Sentry from '@sentry/react-native';
import type { Breadcrumb, ErrorEvent } from '@sentry/react-native';
import type { TrailEntry } from '@/lib/crash-trail';
import { devWarn } from '@/lib/log';

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
 * **Expo Go gets a degraded Sentry, not none (#452).** The previous version of this comment said
 * init no-ops there, and our own gate was what made that true — `Sentry.init` itself does not
 * bail. What Expo Go cannot load is the project's custom native code, and the SDK is built for
 * exactly that: `enableNative` resolves to `NATIVE.isNativeAvailable()`, `makeNativeTransportFactory`
 * then returns null, and `init` falls through to `makeFetchTransport` (`dist/js/sdk.js`,
 * `dist/js/transports/native.js` in @sentry/react-native@7.2.0). So in Expo Go:
 *
 *  - JS errors, messages and breadcrumbs DO transmit, over the fetch transport;
 *  - native crash capture, offline envelope caching, mobile replay and the expo context do NOT.
 *
 * That is the difference between a tester's crash being invisible and being triageable, and Expo
 * Go is the only surface reaching testers today (`rules/mobile.md`). Events carry an `expo_go`
 * tag so a triager can tell which runtime produced them — and knows a native process death left
 * nothing here (that one is `crash-trail.ts`'s job, and #83's).
 *
 * DSN comes from `EXPO_PUBLIC_SENTRY_DSN` (public by design); source maps upload with the
 * server-only `SENTRY_AUTH_TOKEN` EAS secret at build time.
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
  if (initialized || !DSN) return;
  initialized = true;
  Sentry.init({
    dsn: DSN,
    sendDefaultPii: false, // never attach IP / cookies / default user
    beforeSend,
    beforeBreadcrumb,
    // A boolean, so it carries nothing about the person — it says which capture surfaces the
    // event's runtime actually had (see the header). scrubEvent leaves tags alone deliberately.
    initialScope: { tags: { expo_go: isExpoGo } },
  });
}

/**
 * Send the previous run's step trail (#452). Called once, after `initSentry`, when the run before
 * this one stopped where it stood — the case where nothing else reaches Sentry, because a native
 * process death raises no JS exception for the SDK to catch.
 *
 * The steps go up as breadcrumbs through the top-level `Sentry.addBreadcrumb`, which is the path
 * that runs `beforeBreadcrumb` (a scope's own `addBreadcrumb` does not) — so they are dropped
 * pre-consent and redacted like any other crumb, and `scrubEvent` re-scrubs them on the way out.
 * No-ops before init, so a revoked consent means nothing leaves.
 */
export function captureTrail(steps: readonly TrailEntry[]): void {
  if (!initialized || steps.length === 0) return;
  for (const step of steps) {
    Sentry.addBreadcrumb({
      category: 'app.lifecycle',
      level: 'info',
      // i18n-ignore — a step name and a millisecond offset, not copy.
      message: `${step.s} +${step.t}ms`,
    });
  }
  // A Sentry event title, never rendered to a member — so it stays out of @athanor/i18n. It
  // needs no exemption today; reword it into plain prose and the checker will rightly ask for one.
  Sentry.captureMessage('crash-trail: previous session did not exit cleanly', 'warning');
}

/** Tear Sentry down when consent is revoked / on logout. */
export function closeSentry(): void {
  if (!initialized) return;
  initialized = false;
  // Best-effort flush: `initialized` is already false, so a failed close must not become an
  // unhandled rejection on logout / consent revoke (#179).
  Sentry.close().catch((e: unknown) => devWarn('[sentry] close', e));
}
