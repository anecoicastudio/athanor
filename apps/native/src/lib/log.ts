/**
 * Dev-only diagnostic log for best-effort/swallowed failures (audit 2026-07-09:
 * silent `catch {}` hid errors even in dev). Same idiom as the pre-existing
 * `if (__DEV__) console.warn('[scope] …', e)` sites. Deliberately NOT wired to
 * Sentry: no general capture helper is exported (consent-gated init), and
 * beforeBreadcrumb drops console crumbs anyway — this is dev visibility only.
 * `sentry.ts` exports only fixed-title reports for named failures
 * (`captureTrail`, `capturePushFailure`); a swallowed error that must be seen in
 * production gets one of those, never a raw message.
 */
export const devWarn = (scope: string, e: unknown): void => {
  if (__DEV__) console.warn(scope, e);
};
