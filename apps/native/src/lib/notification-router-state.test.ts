import { describe, expect, it, vi } from 'vitest';
import {
  consumeResponse,
  decideRoute,
  mergeResponse,
  type TappedResponse,
} from './notification-router-state';

const DEFAULT_ACTION = 'expo.modules.notifications.actions.DEFAULT';

function tap(identifier: string, data: unknown, actionIdentifier = DEFAULT_ACTION): TappedResponse {
  return { actionIdentifier, notification: { request: { identifier, content: { data } } } };
}

describe('mergeResponse — the two sources can both miss, so neither may erase the other', () => {
  it('keeps what is held when the observation is empty', () => {
    // The native read is emptied by `clearLastNotificationResponse`, and it returns null on a
    // surface with no native module at all. Neither may take a destination out of our hands.
    const held = tap('a', { type: 'message' });
    expect(mergeResponse(held, null)).toBe(held);
  });

  it('takes the observation when nothing is held', () => {
    const observed = tap('a', { type: 'message' });
    expect(mergeResponse(null, observed)).toBe(observed);
  });

  it('returns the HELD object when the identifier is unchanged', () => {
    // Identity, not equality: the consuming effect keys on this value, and a re-read returns a
    // freshly mapped object for the same tap. Handing back a new object would re-run the effect
    // on every foreground.
    const held = tap('a', { type: 'message' });
    const sameTapReadAgain = tap('a', { type: 'message' });
    expect(mergeResponse(held, sameTapReadAgain)).toBe(held);
  });

  it('takes the observation when a newer tap arrives', () => {
    const held = tap('a', { type: 'message' });
    const newer = tap('b', { type: 'moment' });
    expect(mergeResponse(held, newer)).toBe(newer);
  });

  it('holds nothing when nothing has been seen', () => {
    expect(mergeResponse(null, null)).toBeNull();
  });
});

describe('decideRoute', () => {
  it('stays idle with no response in hand', () => {
    expect(decideRoute(null, null, DEFAULT_ACTION)).toEqual({ kind: 'idle' });
  });

  it('ignores anything but the plain tap', () => {
    // No action buttons are registered today. The day one is, it must not inherit the body's
    // destination — the trap Expo's own example calls out.
    const action = tap('a', { type: 'message' }, 'REPLY');
    expect(decideRoute(action, null, DEFAULT_ACTION)).toEqual({ kind: 'idle' });
  });

  it('ignores a tap it has already acted on', () => {
    const held = tap('a', { type: 'message' });
    expect(decideRoute(held, 'a', DEFAULT_ACTION)).toEqual({ kind: 'idle' });
  });

  it('acts on a new tap even while another is latched', () => {
    const held = tap('b', { type: 'moment' });
    expect(decideRoute(held, 'a', DEFAULT_ACTION)).toEqual({
      kind: 'act',
      id: 'b',
      href: '/(tabs)/momenti',
    });
  });

  it('resolves the destination from the push payload', () => {
    const held = tap('a', { type: 'message' });
    expect(decideRoute(held, null, DEFAULT_ACTION)).toEqual({
      kind: 'act',
      id: 'a',
      href: '/(modal)/messages',
    });
  });

  it('acts with no destination when the type has none', () => {
    // A warn still opened the app, which is the whole of what it had to do. It is consumed —
    // latched and cleared — so a remount cannot re-evaluate it, but nothing is navigated.
    const held = tap('a', { type: 'moderation' });
    expect(decideRoute(held, null, DEFAULT_ACTION)).toEqual({ kind: 'act', id: 'a', href: null });
  });

  it('acts with no destination on a payload it cannot read', () => {
    const held = tap('a', 'not an object');
    expect(decideRoute(held, null, DEFAULT_ACTION)).toEqual({ kind: 'act', id: 'a', href: null });
  });

  it('acts with no destination when the notification carries no data at all', () => {
    // `data` is optional in expo's `NotificationContent`, so this is a shape the OS can hand us
    // rather than a hypothetical.
    const held: TappedResponse = {
      actionIdentifier: DEFAULT_ACTION,
      notification: { request: { identifier: 'a', content: {} } },
    };
    expect(decideRoute(held, null, DEFAULT_ACTION)).toEqual({ kind: 'act', id: 'a', href: null });
  });
});

describe('consumeResponse — the ordering #820 turns on', () => {
  function effects() {
    const order: string[] = [];
    return {
      order,
      navigate: vi.fn(() => void order.push('navigate')),
      latch: vi.fn(() => void order.push('latch')),
      clearNative: vi.fn(() => void order.push('clearNative')),
      onError: vi.fn(),
    };
  }

  it('navigates BEFORE it latches and clears', () => {
    // The whole of #820's fix. The native response is the only source that survives a remount,
    // and the latch is the only thing that stops a replay — destroying both before the
    // navigation has been dispatched leaves a lost push unrecoverable by anything.
    const fx = effects();
    expect(consumeResponse({ kind: 'act', id: 'a', href: '/(modal)/messages' }, fx)).toBe(
      'consumed',
    );
    expect(fx.order).toEqual(['navigate', 'latch', 'clearNative']);
    expect(fx.navigate).toHaveBeenCalledWith('/(modal)/messages');
  });

  it('defers, unlatched and uncleared, when the navigation throws', () => {
    // `deferred` is the caller's cue to let go of the response it holds, without which the tap
    // could never be taken again. A throw here must also never reach the effect that called it:
    // a missing route is not a crashed boot.
    const fx = effects();
    fx.navigate.mockImplementation(() => {
      throw new Error('no navigator');
    });
    let outcome;
    expect(() => {
      outcome = consumeResponse({ kind: 'act', id: 'a', href: '/(modal)/messages' }, fx);
    }).not.toThrow();
    expect(outcome).toBe('deferred');
    expect(fx.latch).not.toHaveBeenCalled();
    expect(fx.clearNative).not.toHaveBeenCalled();
    expect(fx.onError).toHaveBeenCalledWith('navigate', expect.any(Error));
  });

  it('latches and clears a tap with no destination', () => {
    const fx = effects();
    expect(consumeResponse({ kind: 'act', id: 'a', href: null }, fx)).toBe('consumed');
    expect(fx.navigate).not.toHaveBeenCalled();
    expect(fx.order).toEqual(['latch', 'clearNative']);
  });

  it('stays latched when the native clear throws', () => {
    // expo-web has no native module and the clear throws UnavailabilityError. The latch has
    // already run, so the tap is still consumed for this JS lifetime.
    const fx = effects();
    fx.clearNative.mockImplementation(() => {
      throw new Error('UnavailabilityError');
    });
    let outcome;
    expect(() => {
      outcome = consumeResponse({ kind: 'act', id: 'a', href: null }, fx);
    }).not.toThrow();
    expect(outcome).toBe('consumed');
    expect(fx.latch).toHaveBeenCalledWith('a');
    expect(fx.onError).toHaveBeenCalledWith('clear', expect.any(Error));
  });

  it('does nothing at all on idle', () => {
    const fx = effects();
    expect(consumeResponse({ kind: 'idle' }, fx)).toBe('idle');
    expect(fx.order).toEqual([]);
    expect(fx.onError).not.toHaveBeenCalled();
  });
});
