import { INVITE_URL_BASE } from './links';

/**
 * The share payload every referral surface hands to the native share sheet (P4.1).
 *
 * One home, because the message is what makes an activation attributable: the text has to end
 * in a URL that `app/invite/[code].tsx` catches, and that catcher reads the LAST path segment.
 * Before #242 the same expression sat inline at three call sites (`home/InviteCard`,
 * `home/PrimeStelleCard`, `(modal)/settings`); the fund card would have been the fourth, and
 * four copies of a link format is how one of them quietly stops being caught.
 *
 * Pure by design — no `t()`, no query, no `Share`. Copy arrives already resolved, so the caller
 * owns the locale and this owns only the shape. That is also the only reason any of it is
 * tested: `.tsx` is uncollectable in this harness.
 *
 * NOT a validator. `lib/referral.ts` decides what a code is (and never rejects, #179); a code
 * that is absent or still loading yields a message with no link rather than no message — an
 * unattributed share beats a blocked one.
 */

/** `https://www.athanor.workers.dev/invite/<CODE>` — the URL `app/invite/[code].tsx` catches. */
export function inviteUrl(code: string): string {
  return `${INVITE_URL_BASE}/${code}`;
}

export function inviteShareMessage({
  lead,
  appName,
  code,
}: {
  /** The already-localised line that opens the share — the caller's `t()` result. */
  lead: string;
  appName: string;
  /** The sharer's referral code, or nullish while the session-gated query is in flight. */
  code: string | null | undefined;
}): string {
  const link = code ? ` ${inviteUrl(code)}` : '';
  return `${lead} — ${appName}${link}`;
}
