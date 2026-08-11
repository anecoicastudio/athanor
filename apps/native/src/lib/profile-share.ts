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
 * **No URL yet, deliberately.** `apps/web` serves `/@handle`, but the anon
 * SELECT policy on `profiles` requires a visibility value of `'public'`, and
 * `visibility` defaults to `'{}'` while the editor defaults every field to
 * `'members'`. So a link would 404 for every member who has not explicitly
 * opted a field public — which is every new signup. Deferred, not forgotten.
 *
 * Returns `null` when there is no handle. Callers must not render a share
 * control at all in that case, rather than opening a sheet on a bare app name.
 */
export function profileShareMessage(handle: string | null | undefined, appName: string) {
  const trimmed = handle?.trim() ?? '';
  const bare = trimmed.startsWith('@') ? trimmed.slice(1) : trimmed;
  if (!bare) return null;
  return `@${bare} — ${appName}`;
}
