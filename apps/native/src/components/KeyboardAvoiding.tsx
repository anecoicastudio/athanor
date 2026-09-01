import { type ReactNode } from 'react';
import { View } from 'react-native';
import { useKeyboardInset } from '@/hooks/use-keyboard-inset';

/**
 * The one keyboard-avoidance recipe (#163, remeasured for #616). Wrap a screen
 * in it and the content region shrinks to sit above the soft keyboard.
 *
 * Goes OUTSIDE `Screen`, not inside — six of the eight consumers already spell it
 * that way, and `Screen`'s docblock is written for it: its bottom safe-area inset
 * measures 0 while this wrapper has lifted the view off the window bottom, so the
 * home indicator is not reserved twice. The two exceptions (`plan`, `progress`)
 * put it inside because they use `Screen footer`, which pins an action bar the
 * wrapper is not meant to lift.
 *
 * The measurement and its arithmetic live in `hooks/use-keyboard-inset.ts` — read
 * that docblock for why `KeyboardAvoidingView` is gone and why measuring at
 * keyboard time (not at mount) is the fix. Layout style, not themable UI, hence
 * no `@/tw` here.
 *
 * Static-audit invariant (`lib/source-audit.test.ts` §8): `KeyboardAvoidingView`
 * appears nowhere in the app, and the hook has exactly two consumers — this file
 * and `StoriesViewer`, whose chrome is an absolute overlay rather than a flex
 * column and so cannot take this wrapper's shape. Wrap, don't copy.
 */
export function KeyboardAvoiding({ children }: { children: ReactNode }) {
  const { ref, onLayout, inset } = useKeyboardInset();
  return (
    <View ref={ref} onLayout={onLayout} style={{ flex: 1, paddingBottom: inset }}>
      {children}
    </View>
  );
}
