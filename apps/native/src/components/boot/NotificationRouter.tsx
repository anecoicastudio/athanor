import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import * as Notifications from 'expo-notifications';
import { useRouter } from 'expo-router';
import { devWarn } from '@/lib/log';
import {
  consumeResponse,
  decideRoute,
  mergeResponse,
  type TappedResponse,
} from '@/lib/notification-router-state';

/**
 * Sends a tapped OS banner where it says it is going (#637 item 1). No UI.
 *
 * Until this existed the app registered exactly one expo-notifications callback — the foreground
 * handler in `lib/push.ts` — and no response listener at all. `routeForNotification` was a
 * complete per-type router consumed only by the in-app notification centre, so every template,
 * every per-category opt-out and the whole push investment were unreachable from the surface
 * members actually tap: a banner opened the app wherever it last was.
 *
 * ## Why it mounts in `(tabs)/_layout`, beside PushPrimer
 *
 * The response has to be consumed AFTER routing has settled, not before. `AuthGuard` fires a
 * `router.replace` when the session and profile settle, and React runs child effects before
 * parent ones — so a listener mounted inside the guard would push its destination and then watch
 * the guard replace it. Mounting here inverts that: the tabs layout only exists once a signed-in,
 * complete profile has been parked in the authed world, which is precisely the condition under
 * which a member-facing destination is safe to open. A cold-start tap therefore lands on the deck
 * for an instant and then opens its target, rather than racing the guard and losing.
 *
 * That argument is about mount ordering, and on a cold start the mount is itself produced by the
 * guard's own `router.replace('/(tabs)')` once the profile hydrates — so it is worth saying what
 * makes the destination stick rather than assuming it. With a complete profile the guard has no
 * branch left that fires: `next` is null, and the only replace on that arm is gated on
 * `inAuth || inOnboarding`. Once the push moves the segments to `(modal)`, every branch in the
 * guard's effect falls through. It cannot take the destination back.
 *
 * A tap that arrives while the member is signed out, mid-onboarding or on the recovery sheet is
 * not dropped — `getLastNotificationResponse` reads NATIVE state that survives until it is
 * cleared, so it is still there to be read the moment the tabs mount.
 *
 * ## Two sources, one consumption — and both of them can miss (#820)
 *
 * `addNotificationResponseReceivedListener` covers a tap while the app is backgrounded;
 * `getLastNotificationResponse` covers the cold start, where the tap happened before any JS ran.
 * Only the backgrounded arm routed on a real device. #820 is fixed on the ORDERING below —
 * the latch and the native clear were spent before `router.push`, which is what makes a push
 * that does not take unrecoverable. That is the mechanism; `lib/notification-router-state`
 * carries the argument.
 *
 * The sources are hardened alongside it, because each is one-shot in its own way and neither
 * was positioned to cover for the other:
 *
 *  - the cold read was a lazy `useState` initializer, so it ran ONCE, during the first render,
 *    and nothing ever read it again. On Android the native bundle is normally populated well
 *    before that render — `NotificationManager` replays a queued tap into the emitter at
 *    module-registration time — so this read usually SUCCEEDS. It has no second chance if it
 *    ever does not;
 *  - the listener cannot be that second chance for a cold start, because the `sendEvent` that
 *    accompanies that same replay fires before the JS bundle has evaluated and expo's emitter
 *    does not buffer. It is a second window that can miss, not a fallback.
 *
 * So the subscription is now established FIRST, in a layout effect (the same reason Expo's own
 * `useLastNotificationResponse` uses one), and the native read happens inside it, behind the
 * listener rather than ahead of it — a tap landing between the two would otherwise be seen by
 * neither. The read is repeated whenever the app returns to the foreground: that is the one edge
 * a tap is guaranteed to produce on BOTH arms. `mergeResponse` keeps the repeat cheap — the same
 * tap read twice returns the object already held, so the consuming effect does not re-run.
 *
 * The decision and the ordering live in `lib/notification-router-state`, which the node test
 * harness can reach; this file is the wiring.
 *
 * `getLastNotificationResponse` and not the deprecated `…Async` — the installed
 * expo-notifications@57.0.20 says so in its own JSDoc. Every native call is wrapped: on expo-web
 * the native module is absent and the emitter throws `UnavailabilityError`. A missing route must
 * never be a crashed boot.
 *
 * NOTE: a FOREGROUND tap cannot reach this. `lib/push.ts` sets `shouldShowBanner: false`, so a
 * notification arriving while the app is open shows no banner to tap — by design (rule #3, the
 * in-app ✦ pip updates instead). Everything here is background and cold start, which is why it
 * cannot be exercised on expo-web at all, and why a simulator cannot exercise it either:
 * `registerForPush` returns null on anything but a device (`!Device.isDevice`), so there is no
 * token to push to and no banner to tap. It takes a real device and a real push.
 */
function lastResponse(): TappedResponse | null {
  try {
    return Notifications.getLastNotificationResponse() ?? null;
  } catch (e) {
    devWarn('[push] cold-start response unavailable', e);
    return null;
  }
}

export function NotificationRouter() {
  const router = useRouter();
  const [response, setResponse] = useState<TappedResponse | null>(null);
  // Which tap has already been acted on, by notification identifier. An identifier and not the
  // object, because the native state is now read more than once and a re-read returns a freshly
  // mapped object for the same tap.
  const handledId = useRef<string | null>(null);

  useLayoutEffect(() => {
    const observe = (seen: TappedResponse | null) =>
      setResponse((held) => mergeResponse(held, seen));

    let subscription: { remove: () => void };
    try {
      subscription = Notifications.addNotificationResponseReceivedListener(observe);
    } catch (e) {
      // No native module — expo-web. There is no native state to read either, so there is
      // nothing to observe and no foreground edge worth subscribing to.
      devWarn('[push] response listener unavailable', e);
      return;
    }
    // Only now, with the listener in place: a tap that lands between the two would otherwise be
    // seen by neither.
    observe(lastResponse());

    const appState = AppState.addEventListener('change', (state) => {
      if (state === 'active') observe(lastResponse());
    });
    return () => {
      subscription.remove();
      appState.remove();
    };
  }, []);

  useEffect(() => {
    const outcome = consumeResponse(
      decideRoute(response, handledId.current, Notifications.DEFAULT_ACTION_IDENTIFIER),
      {
        navigate: (href) => router.push(href as Parameters<typeof router.push>[0]),
        latch: (id) => {
          handledId.current = id;
        },
        clearNative: () => Notifications.clearLastNotificationResponse(),
        onError: (stage, e) => devWarn(`[push] tapped banner: ${stage}`, e),
      },
    );
    // The navigation did not take, so nothing was latched and the native response is intact.
    // Letting go of what we hold is what re-arms it: `mergeResponse` folds a re-read of the same
    // tap back into the object already held, so without this the next foreground read would
    // change nothing and this effect would never run again for it.
    //
    // Yes, this is a `setState` on the effect's own dependency — the shape the removed
    // cold-read initializer was written to avoid (#691). The objection there was that the value
    // was DERIVABLE during render and a reset made it lag by a commit. Nothing is derivable
    // here: whether `router.push` threw is knowable only after it is called. It terminates, too
    // — `null` decides to `idle` on the next pass, and only a fresh native read revives it.
    if (outcome === 'deferred') setResponse(null);
  }, [response, router]);

  return null;
}
