import { SITE_ORIGIN } from './links';

/**
 * The message the native share sheet carries for a member profile (issue #110).
 *
 * One builder for every surface that shares a profile — the own-profile tab and
 * person detail both call it — so the two cannot drift apart, and so the shape
 * is asserted somewhere.
 *
 * `appName` is passed in rather than read from `@athanor/i18n` so this stays a
 * pure function: the caller already holds the locale.
 *
 * The `/@handle` URL is carried since #251: the default public shell (identity
 * facet `'public'` by default, migration 20260814151601) means a shared link
 * resolves for every member who has not explicitly opted out — and a member who
 * DID opt out chose the dead link knowingly (the editor says so next to the
 * control). Before #251 this builder deliberately carried no URL, because the
 * link 404'd for every default signup.
 *
 * Returns `null` when there is no handle. Callers must not render a share
 * control at all in that case, rather than opening a sheet on a bare app name.
 */
export function profileShareMessage(handle: string | null | undefined, appName: string) {
  const trimmed = handle?.trim() ?? '';
  const bare = trimmed.startsWith('@') ? trimmed.slice(1) : trimmed;
  if (!bare) return null;
  return `@${bare} — ${appName}\n${SITE_ORIGIN}/@${bare}`;
}
