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
 * The `/@handle` URL is carried only when that page exists (`hasPublicPage`).
 * #251 made the page the default and put the URL here; #790 made «Membri» the
 * default for new members, so the page — and a working link — is opt-in again.
 * Without it the message is the handle and the app name, which is what this
 * builder sent before #251 for the same reason: a link that 404s is worse than
 * none. The own profile knows its identity facet; another member's comes from
 * `get_person_profile.has_public_page`.
 *
 * Returns `null` when there is no handle. Callers must not render a share
 * control at all in that case, rather than opening a sheet on a bare app name.
 */
export function profileShareMessage(
  handle: string | null | undefined,
  appName: string,
  hasPublicPage: boolean,
) {
  const trimmed = handle?.trim() ?? '';
  const bare = trimmed.startsWith('@') ? trimmed.slice(1) : trimmed;
  if (!bare) return null;
  const head = `@${bare} — ${appName}`;
  return hasPublicPage ? `${head}\n${SITE_ORIGIN}/@${bare}` : head;
}
