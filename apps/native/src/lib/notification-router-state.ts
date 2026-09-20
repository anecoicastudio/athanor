/**
 * What `components/boot/NotificationRouter` does with a tapped OS banner, as data (#820).
 *
 * The component itself is a `.tsx` that renders `null`, and `vitest.config.ts` collects only
 * `.test.ts` files under `environment: 'node'` — react-native ships untranspiled Flow, so
 * nothing that renders is reachable by this harness. #820 is an ORDERING bug, and an ordering
 * bug with no test is the kind that comes back. So the decision and the sequence live here,
 * where they are node-collectable, and the component keeps only the wiring to
 * expo-notifications and the router. Same move #413 made for the candidacy wizard.
 *
 * ## The two sources, and why neither may erase the other
 *
 * `getLastNotificationResponse()` reads an INSTANCE field on the native emitter module
 * (`NotificationsEmitter.kt` — `lastNotificationResponseBundle`), populated when
 * `NotificationManager` replays a queued tap at module-registration time. That replay also fires
 * `sendEvent`, and it fires it before the JS bundle has evaluated, so no
 * `addNotificationResponseReceivedListener` can ever hear it: the emitter does not buffer. The
 * two sources therefore cover disjoint windows, and a read that comes back empty means «not
 * here», never «gone».
 */
import { routeForPushData } from './notification-route';

/**
 * The shape this module needs out of `Notifications.NotificationResponse`. Structural on
 * purpose: the node harness has no native module to import a type through, and the fields below
 * are the whole of what the decision reads.
 */
export type TappedResponse = {
  actionIdentifier: string;
  // `data` is OPTIONAL in expo's own `NotificationContent`, and a push that arrives without one
  // is exactly the case `routeForPushData` answers with null — a tap that opened the app and
  // cannot say where to go.
  notification: { request: { identifier: string; content: { data?: unknown } } };
};

/**
 * Fold a fresh observation into the response already in hand.
 *
 * Returns the HELD object when the identifier is unchanged, so the consuming effect — which
 * keys on this value — does not re-run every time the app comes back to the foreground and the
 * native state is read again.
 */
export function mergeResponse(
  held: TappedResponse | null,
  observed: TappedResponse | null,
): TappedResponse | null {
  if (!observed) return held;
  if (!held) return observed;
  return held.notification.request.identifier === observed.notification.request.identifier
    ? held
    : observed;
}

/**
 * `act` carries a `null` href when the tap has no destination: a warn, the moderation queue.
 * That still gets latched and cleared — it opened the app, which is the whole of what it had to
 * do, and staying put is the answer rather than a fallback.
 */
export type RouteDecision = { kind: 'idle' } | { kind: 'act'; id: string; href: string | null };

export function decideRoute(
  held: TappedResponse | null,
  handledId: string | null,
  defaultActionIdentifier: string,
): RouteDecision {
  if (!held) return { kind: 'idle' };
  // Only the plain tap. An action button (none are registered today) must not inherit the
  // body's destination the day one is, which is the trap Expo's own example calls out.
  if (held.actionIdentifier !== defaultActionIdentifier) return { kind: 'idle' };
  const id = held.notification.request.identifier;
  if (handledId === id) return { kind: 'idle' };
  return { kind: 'act', id, href: routeForPushData(held.notification.request.content.data) };
}

export type ConsumeEffects = {
  navigate: (href: string) => void;
  latch: (id: string) => void;
  clearNative: () => void;
  onError: (stage: 'navigate' | 'clear', e: unknown) => void;
};

/**
 * `deferred` means the navigation did not take: nothing was latched, nothing was cleared, and
 * the tap is still there to be acted on. The caller has to DO something with that — see the
 * note on retrying in `consumeResponse`.
 */
export type ConsumeOutcome = 'idle' | 'consumed' | 'deferred';

/**
 * Navigate FIRST, then consume — the ordering #820 turns on.
 *
 * Until this, the native clear and the handled latch both ran ahead of `router.push`. The latch
 * is the only thing that stops a replay and the native response is the only source that survives
 * a remount, so spending both before the navigation had even been dispatched meant a push that
 * did not take was unrecoverable: nothing left to re-read, nothing left to retry. Reversed, a
 * failed navigation leaves the tap exactly where it was.
 *
 * Leaving it there is not by itself a retry, and the caller must not assume it is. A re-read of
 * the same tap folds back into the response already held (`mergeResponse` keeps identity so the
 * consuming effect does not churn), so nothing would re-run. `deferred` is the signal to let go
 * of what is held, which is what lets the next read take the same tap again as a new value.
 *
 * Neither side effect may throw out of here. A missing route must never be a crashed boot.
 */
export function consumeResponse(decision: RouteDecision, effects: ConsumeEffects): ConsumeOutcome {
  if (decision.kind === 'idle') return 'idle';
  if (decision.href !== null) {
    try {
      effects.navigate(decision.href);
    } catch (e) {
      effects.onError('navigate', e);
      return 'deferred';
    }
  }
  effects.latch(decision.id);
  try {
    effects.clearNative();
  } catch (e) {
    // Belt and braces at this point: the latch above already holds for this JS lifetime, and
    // the clear is what stops a REMOUNT replaying a route the member already took.
    effects.onError('clear', e);
  }
  return 'consumed';
}
