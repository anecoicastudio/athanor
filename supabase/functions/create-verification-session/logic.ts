import type Stripe from 'npm:stripe@22';
import { error, json } from '../_shared/respond.ts';
import {
  logStripeFailure,
  type StripeFailureSink,
  stripeFailureClass,
} from '../_shared/stripe-error.ts';

// Session construction extracted from index.ts so it is unit-testable (deno test):
// index.ts keeps the transport shell (OPTIONS/method guard, requireUser, version gate,
// env + singleton wiring) and injects everything here (repo convention: DI over mocks).
// Deliberately does NOT import ../_shared/stripe.ts — only type-level `npm:stripe`: the
// Stripe capabilities arrive injected. #541 made that module lazy, so the import would no
// longer demand STRIPE_SECRET_KEY in a test env; the boundary stays because DI is the point.
// ../_shared/stripe-error.ts is safe to import for real: it reads no env and constructs no
// client — and since #541 neither does ../_shared/stripe.ts until something calls it.

/** The Stripe call this function makes — the string that names the failure in the logs. */
const OPERATION = 'identity.verificationSessions.create';

/**
 * The `{error}` strings are the stable contract the verify sheet maps to copy (#103 idiom,
 * as create-contribution-session already does for its window refusal). Two, because they are
 * the two outcomes a member can act on differently:
 *
 * - UNAVAILABLE — Stripe refused our own request (Identity not activated on the account, a key
 *   without the permission, an API-version mismatch). Operator's to fix; retrying cannot.
 * - FAILED — Stripe's side or the network. Retrying is exactly right.
 */
export const VERIFICATION_UNAVAILABLE = 'verification unavailable';
export const VERIFICATION_FAILED = 'could not start verification';

export type VerificationSessionCtx = {
  /** stripe.identity.verificationSessions.create — the only outbound call; no charge */
  createVerificationSession: (
    params: Stripe.Identity.VerificationSessionCreateParams,
  ) => Promise<Stripe.Identity.VerificationSession>;
  /** IDENTITY_RETURN_BASE, falling back to APP_DEEPLINK_BASE (default 'athanor://') */
  appBase: string;
  /** where failure lines go; defaults to console.error → the function logs. Injected in tests. */
  logFailure?: StripeFailureSink;
};

export type VerificationSessionInput = {
  /** the verified caller (requireUser) — NEVER trusted from the body */
  profileId: string;
};

/**
 * Stripe validates `return_url` and takes only an http(s) URL. APP_DEEPLINK_BASE is a deep-link
 * scheme, so `athanor://verify?status=complete` came back 400 `url_invalid` on `return_url`
 * ("Not a valid URL", req_D4htdcThguUBCp) — every single verification start, which is what #416
 * was actually reporting once the bare catch stopped eating it.
 *
 * `return_url` is optional, so it is sent only when it is one Stripe will accept. Omitting it
 * costs this flow nothing: the sheet never learned the outcome from the redirect. Identity is
 * asynchronous — the document is reviewed after the browser closes — so the flip has always come
 * from webhook W9 over realtime, and `WebBrowser.openAuthSessionAsync` already treats a dismiss
 * exactly like a redirect.
 *
 * #418 supplies that https base: apps/web serves `/app/verify`, which forwards to
 * `athanor://verify`, and IDENTITY_RETURN_BASE points here at it. This function needed no change
 * beyond the env read — the guard below is what made the switch a config change. It is NOT
 * APP_DEEPLINK_BASE repointed; see the note at the call site in index.ts for why that would
 * break four other flows.
 */
export function stripeReturnUrl(appBase: string, path: string): string | undefined {
  const url = `${appBase}${path}`;
  return /^https?:\/\//i.test(url) ? url : undefined;
}

/**
 * Pure params builder. `profile_id` in metadata is what webhook W9 reads back to write the
 * verifications row and flip profiles.identity_verified — so it must come from getUser(),
 * never from the request body (rule #8).
 */
export function buildVerificationSessionParams(
  profileId: string,
  appBase: string,
): Stripe.Identity.VerificationSessionCreateParams {
  const returnUrl = stripeReturnUrl(appBase, 'verify?status=complete');
  return {
    type: 'document',
    metadata: { profile_id: profileId },
    ...(returnUrl ? { return_url: returnUrl } : {}),
  };
}

/**
 * Creates a Stripe Identity VerificationSession and returns its hosted URL. Writes nothing:
 * the verifications row and the profiles.identity_verified flip are the webhook's job (W9),
 * never this function's (rule #6 — money and trust state is a cache of Stripe webhooks).
 *
 * The catch binds (#416). It used to be bare, so an unactivated Identity product and a rate
 * limit produced the same 500 and the same silence — the reason reached no log, and the sheet
 * could only ever say «Riprova» against something retrying could not fix.
 */
export async function createVerificationSession(
  ctx: VerificationSessionCtx,
  input: VerificationSessionInput,
): Promise<Response> {
  try {
    const session = await ctx.createVerificationSession(
      buildVerificationSessionParams(input.profileId, ctx.appBase),
    );
    // Stripe types url as nullable; handing the app a null would surface as a tap that
    // silently does nothing rather than an error anyone can act on.
    if (!session.url) {
      logStripeFailure(
        OPERATION,
        new Error(`session ${session.id ?? '(no id)'} has no url`),
        ctx.logFailure,
      );
      return error(VERIFICATION_FAILED, 500);
    }
    return json({ url: session.url });
  } catch (e) {
    const facts = logStripeFailure(OPERATION, e, ctx.logFailure);
    // The classifier's precondition holds here: buildVerificationSessionParams takes no
    // caller-supplied value beyond the profile id derived from getUser(), so a 4xx from Stripe
    // is our configuration and never the member's doing. Response stays generic either way —
    // the Stripe message is the operator's to read in the logs, never the client's (rule #6).
    if (stripeFailureClass(facts) === 'configuration') return error(VERIFICATION_UNAVAILABLE, 503);
    return error(VERIFICATION_FAILED, 500);
  }
}
