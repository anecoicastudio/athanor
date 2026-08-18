/**
 * The `athanor://` targets the `/app/*` hand-off pages forward to (#418).
 *
 * One module because these three strings ARE the allowlist: `AppReturnView` never derives
 * its destination from the request, so the only way a new destination appears is a new
 * entry here plus a new static route. Keeping them together is what makes that reviewable.
 *
 * Two slashes, not three. `athanor:///auth-callback` is what expo-linking's `createURL`
 * emits (empty host → leading slash) and is right for the OAuth allow-list, but every
 * target below is consumed by `WebBrowser.openAuthSessionAsync`, which matches on the
 * scheme and hands the URL back to the caller instead of routing it — so these mirror the
 * two-slash form the call sites already pass as their redirect argument
 * (`athanor://verify`, `athanor://circle`, `athanor://annual`).
 *
 * The payout pair is multi-segment on purpose. If one of these ever does reach the OS as a
 * real deep link — the auth session was dismissed, or the link was opened in the system
 * browser — a multi-segment stray lands on the app's branded `+not-found`, while a
 * single-segment one falls into `[handle].tsx` and is rejected as a malformed profile.
 */
export const APP_RETURN_TARGETS = {
  /** Stripe Identity `return_url`, paired with `(modal)/verify.tsx`'s redirect argument. */
  verify: 'athanor://verify',
  /** Account Links `return_url` — the member left the Connect onboarding form. */
  payoutReturn: 'athanor://payout/return',
  /** Account Links `refresh_url` — the link expired or was rejected; mint a new one. */
  payoutRefresh: 'athanor://payout/refresh',
} as const;

/** The one scheme these pages are ever allowed to forward to. */
export const APP_SCHEME = 'athanor://';
