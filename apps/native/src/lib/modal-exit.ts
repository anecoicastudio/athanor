import { useCallback } from 'react';
import { useRouter, type Href } from 'expo-router';

/**
 * The one exit for a `(modal)` screen (#578).
 *
 * `router.back()` is a SILENT no-op when the screen is the root of its stack, and a `(modal)`
 * screen is the stack root far more often than the in-app push path suggests:
 *
 * - `AuthGuard` only ever `replace`s (`src/app/_layout.tsx:62,71,74`), so anything the gate
 *   routes to starts life as a root.
 * - `src/app/[handle].tsx:52` `replace`s every `/@handle` link into `/(modal)/user/[id]` —
 *   that screen is a stack root on EVERY deep link to it, cold start or warm.
 * - the Android `intentFilters` (`app.json`) claim `/post`, `/event` and `/dream`, and no
 *   top-level route directory answers them, so they resolve into `(modal)` too.
 * - a screen reached by a modal→modal `replace` inherits the root-ness of the screen it
 *   replaced (`delete-account` → `data-export`, `candidacy-success` → `annual`, …).
 *
 * In every one of those cases an unconditional `back()` renders a button that does nothing at
 * all: no throw, no warning, no navigation. The member is stranded on a screen whose only exit
 * is force-quitting the app.
 *
 * So the decision lives here and nowhere else, and `source-audit.test.ts` §23 fails the build
 * if a `(modal)` screen or a shared component pops the stack any other way.
 *
 * ## Why `dismissTo` and not `replace`
 *
 * `dismissTo` is `POP_TO`: it pops back to the fallback route when it is already below us, and
 * expo-router's vendored `StackRouter` degrades it to "remove the current route and add
 * the new one" when it is not — the right behaviour in both directions, where `replace` would
 * flatten a real stack.
 *
 * `dismissTo` resolves the href through `linkTo` first, so the fallback is an ordinary route
 * path and is NOT restricted to the four groups the root Stack declares: a nested tab
 * (`/(tabs)/momenti`) and a `(modal)` sibling (`/(modal)/live`) both work, because `(modal)`
 * declares every one of its screens in its own Stack (`src/app/(modal)/_layout.tsx`) and
 * `(tabs)` its tabs. What POP_TO cannot do is reach a name no navigator declares — the action
 * is then dropped in silence, which is the one failure mode that would reproduce the bug this
 * module exists to kill. So the fallback names a route that exists, and all three shapes were
 * walked on a real stack root before this landed (PR body, #578). `'/(tabs)'` is the default
 * because home is always reachable.
 *
 * ## Why a hook and not the `router` singleton
 *
 * `useRouter()` returns the imperative singleton everywhere except inside a `<Link.Preview>`,
 * where it returns a warning no-op — a previewed screen must not navigate the stack behind it.
 * Reaching for the singleton directly would quietly opt out of that.
 *
 * No sibling unit test: `vitest.config.ts` runs `environment: 'node'` over `src/**\/*.test.ts`
 * and this module imports `expo-router`, which pulls untranspiled react-native. §23 pins the
 * `canGoBack` branch instead, so the guard cannot go vacuous by this file being flattened.
 */

/**
 * The path form of `Href`, excluding the `{ pathname, params }` object.
 *
 * Not a style preference: an object literal is a fresh reference on every render, so a caller
 * passing one would hand back a different callback each time, and a screen holding that
 * callback in an effect's dependency array would tear its effect down and rebuild it every
 * render — `verify.tsx`'s 1600ms auto-dismiss timer is exactly that shape and would never
 * fire. A path is a primitive, so the memo below is stable by construction rather than by a
 * convention someone has to remember. A fallback needing params is a sign the destination is
 * too specific to be a fallback.
 */
export type ExitHref = Extract<Href, string>;

/**
 * Home. Deliberately `'/(tabs)'` and not `'/'` — both `(tabs)/index` and `(onboarding)/index`
 * resolve to `'/'` and onboarding wins the bare path (`src/app/_layout.tsx:68-70`).
 */
export const MODAL_EXIT_FALLBACK: ExitHref = '/(tabs)';

/**
 * Returns the guarded exit: pops the stack when there is one, and lands on `fallback` when
 * this screen IS the stack. Safe to call from anywhere in a screen — a handler, a timeout, an
 * effect's cleanup — because the branch is evaluated at press time, not at render time.
 *
 * Stable across renders (`useRouter()` returns a module singleton and `fallback` is a path), so
 * it is safe in a dependency array.
 *
 * Pass `fallback` only when the screen has a parent more specific than home, and only a route
 * that exists — see POP_TO above.
 */
export function useGuardedBack(fallback: ExitHref = MODAL_EXIT_FALLBACK): () => void {
  const router = useRouter();
  return useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.dismissTo(fallback);
  }, [router, fallback]);
}
