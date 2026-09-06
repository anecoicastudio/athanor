import { useEffect, useRef, useState } from 'react';
import * as Notifications from 'expo-notifications';
import { useRouter } from 'expo-router';
import { devWarn } from '@/lib/log';
import { routeForPushData } from '@/lib/notification-route';

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
 * A tap that arrives while the member is signed out, mid-onboarding or on the recovery sheet is
 * not dropped — `getLastNotificationResponse` reads NATIVE state that survives until it is
 * cleared, so it is still there to be read the moment the tabs mount.
 *
 * ## Two sources, one consumption
 *
 * `addNotificationResponseReceivedListener` covers a tap while the app is backgrounded;
 * `getLastNotificationResponse` covers the cold start, where the tap happened before any JS ran.
 * `clearLastNotificationResponse` afterwards is what stops the cold-start route re-firing every
 * time this component remounts (leaving the tabs for a modal can unmount it).
 *
 * `getLastNotificationResponse` and not the deprecated `…Async` — the installed
 * expo-notifications@0.32.17 says so in its own JSDoc. Both calls are wrapped: on expo-web (the
 * QA surface here, since no simulator can run on this machine) the native module is absent and
 * the emitter throws `UnavailabilityError`. A missing route must never be a crashed boot.
 *
 * NOTE: a FOREGROUND tap cannot reach this. `lib/push.ts` sets `shouldShowBanner: false`, so a
 * notification arriving while the app is open shows no banner to tap — by design (rule #3, the
 * in-app ✦ pip updates instead). Everything here is background and cold start, which is also why
 * it cannot be exercised on expo-web at all.
 */
/**
 * The cold-start read, as a lazy `useState` initializer rather than a `setState` inside the
 * mount effect (#691). It reads NATIVE state that is already there before any JS ran, so
 * reading it once while the component first renders is the same answer the effect got, one
 * commit earlier — and the effect below still consumes it after routing has settled.
 */
function lastResponse(): Notifications.NotificationResponse | null {
  try {
    return Notifications.getLastNotificationResponse() ?? null;
  } catch (e) {
    devWarn('[push] cold-start response unavailable', e);
    return null;
  }
}

export function NotificationRouter() {
  const router = useRouter();
  const [response, setResponse] = useState<Notifications.NotificationResponse | null>(lastResponse);
  // Which response has already been routed. A ref, and written from the effect below: clearing
  // STATE was the old "run once" mechanism, and that was a `setState` inside an effect.
  const handled = useRef<Notifications.NotificationResponse | null>(null);

  useEffect(() => {
    let subscription: { remove: () => void } | null = null;
    try {
      subscription = Notifications.addNotificationResponseReceivedListener(setResponse);
    } catch (e) {
      devWarn('[push] response listener unavailable', e);
    }
    return () => subscription?.remove();
  }, []);

  useEffect(() => {
    if (!response || handled.current === response) return;
    // Only the plain tap. An action button (none are registered today) must not inherit the
    // body's destination the day one is, which is the trap Expo's own example calls out.
    if (response.actionIdentifier !== Notifications.DEFAULT_ACTION_IDENTIFIER) return;

    const href = routeForPushData(response.notification.request.content.data);
    try {
      Notifications.clearLastNotificationResponse();
    } catch (e) {
      devWarn('[push] clearing the last response', e);
    }
    // Marking it handled is what makes this run once — together with the native clear above, a
    // remount cannot replay a route the member already took.
    handled.current = response;
    // A type with no destination (a warn, the moderation queue) still opened the app, which is
    // the whole of what it had to do. Staying put is the answer, not a fallback.
    if (href) router.push(href as Parameters<typeof router.push>[0]);
  }, [response, router]);

  return null;
}
