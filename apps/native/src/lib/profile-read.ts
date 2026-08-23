/**
 * #512 — retrying the profile read that gates the whole session.
 *
 * The profile is read twice outside TanStack Query: once by the hydration effect in
 * auth-context (the sign-in path) and once by `refreshProfile` (what the «Riprova» button on
 * the error screen calls). Both were single-attempt, so one dropped request on a train or in a
 * lift became «Il server non risponde» — and the member's one recovery, the retry button, was
 * itself unretried.
 *
 * The budget and the backoff curve here are deliberately NOT new policy: they are the shared
 * `queryClient`'s (`query-client.ts` — `retry: 2`, and TanStack's default
 * `Math.min(1000 * 2 ** failureCount, 30_000)`). Every other read in the app already behaves
 * this way; these two were the exception, and a second policy is the thing to avoid.
 */

/** Mirrors `query-client.ts`'s `retry: 2` — three attempts in total. */
export const PROFILE_READ_RETRIES = 2;

/** TanStack's default `retryDelay`, restated so the two curves cannot drift apart silently. */
export function profileReadBackoffMs(failureCount: number): number {
  return Math.min(1000 * 2 ** failureCount, 30_000);
}

/**
 * True for a `profileSchema.parse` throw. Matched on `name` rather than `instanceof ZodError`:
 * the error crosses a package boundary (`@athanor/api` → app), and an instance check there is
 * one duplicate zod copy away from silently answering false.
 */
export function isValidationFailure(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { name?: unknown }).name === 'ZodError';
}

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Run `read`, retrying transport-shaped failures on the shared budget.
 *
 * A missing profile row is NOT a failure — `getOwnProfile` returns null for it — so the null
 * travels straight through and a new account still routes to the funnel on the first attempt.
 * A validation failure is not retried: the next attempt reads the same malformed row.
 */
export async function readProfileWithRetry<T>(
  read: () => Promise<T>,
  {
    retries = PROFILE_READ_RETRIES,
    sleep = wait,
  }: {
    retries?: number;
    sleep?: (ms: number) => Promise<void>;
  } = {},
): Promise<T> {
  let failureCount = 0;
  for (;;) {
    try {
      return await read();
    } catch (e) {
      if (failureCount >= retries || isValidationFailure(e)) throw e;
      await sleep(profileReadBackoffMs(failureCount));
      failureCount += 1;
    }
  }
}
