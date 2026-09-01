import { type ReactNode } from 'react';
import { View } from 'react-native';
import { useKeyboardInset } from '@/hooks/use-keyboard-inset';

/**
 * The one keyboard-avoidance recipe (#163, remeasured for #616). Wrap a screen
 * in it and the content region shrinks to sit above the soft keyboard.
 *
 * Goes OUTSIDE `Screen`, not inside — every consumer spells it that way except the
 * two that use `Screen footer` (`plan`, `progress`), which pin an action bar this
 * wrapper is not meant to lift. `Screen`'s docblock is written for the outside
 * form: its bottom safe-area inset measures 0 while this wrapper has lifted the
 * view off the window bottom, so the home indicator is not reserved twice.
 *
 * The measurement and its arithmetic live in `hooks/use-keyboard-inset.ts` — read
 * that docblock for why `KeyboardAvoidingView` is gone and why measuring at
 * keyboard time (not at mount) is the fix. Layout style, not themable UI, hence
 * no `@/tw` here.
 *
 * Static-audit invariant (`lib/source-audit.test.ts` §8): `KeyboardAvoidingView`
 * appears nowhere in the app, and the hook has exactly two consumers — this file
 * and `StoriesViewer`. That one takes the hook rather than this wrapper because
 * its media is a full-bleed `absolute inset-0` sibling of the chrome: padding the
 * root would shrink the photo too, so only the chrome band may carry the inset.
 * Wrap where you can, take the hook where you cannot, copy neither.
 */
export function KeyboardAvoiding({ children }: { children: ReactNode }) {
  const { ref, onLayout, inset } = useKeyboardInset();
  return (
    <View ref={ref} onLayout={onLayout} style={{ flex: 1, paddingBottom: inset }}>
      {children}
    </View>
  );
}
