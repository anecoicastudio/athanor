/**
 * How often a member may rename their @handle (#782 ruling: once every 30 days).
 *
 * The database enforces it — `public.profiles_handle_cooldown` refuses a member's rename while
 * `now() < handle_changed_at + interval '30 days'` — and `handle-cooldown.mirror.test.ts` reads
 * that statement against this number. The app uses it only to know the date before it asks.
 */
export const HANDLE_RENAME_COOLDOWN_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The instant the next rename opens, or `null` when there is no clock running. `changedAt` is
 * `profiles.handle_changed_at`: NULL until the first RENAME — choosing a handle at onboarding
 * leaves it NULL, so a person who mistyped there can fix it at once. Elapsed time, not calendar
 * days: the server's arithmetic runs in UTC, where thirty days are always 720 hours.
 */
export function handleRenameOpensAt(changedAt: string | null): Date | null {
  if (changedAt === null) return null;
  return new Date(Date.parse(changedAt) + HANDLE_RENAME_COOLDOWN_DAYS * DAY_MS);
}

/** Whether a rename would be accepted at `now` — accepted from the opening instant on, as the server does. */
export function canRenameHandle(changedAt: string | null, now: Date): boolean {
  const opens = handleRenameOpensAt(changedAt);
  return opens === null || now.getTime() >= opens.getTime();
}
