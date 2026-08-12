import { useRef, useState, type ReactNode } from 'react';
import { KeyboardAvoidingView, Platform, View } from 'react-native';

/**
 * The one keyboard-avoidance recipe (#163). Five composers had each copied
 * `behavior={Platform.OS === 'ios' ? 'padding' : undefined}` — which pushes by
 * the raw keyboard height on iOS (wrong by the sheet's own top gap plus any
 * header above the scroll area) and is inert on Android.
 *
 * - `keyboardVerticalOffset` is MEASURED, not guessed: the root reports its own
 *   window-top y on layout (`measureInWindow`) — exactly the chrome above this
 *   view, whatever it is (pageSheet gap, header). Same pattern StoriesViewer
 *   proved in-tree; layout style, not themable UI, hence no `@/tw` here.
 * - Android gets an explicit `height` branch instead of `undefined`.
 *
 * Static-audit invariant (`lib/source-audit.test.ts`): outside this file only
 * StoriesViewer (whose chrome is an absolute overlay, not a flex column) may
 * touch KeyboardAvoidingView — wrap, don't copy.
 */
export function KeyboardAvoiding({ children }: { children: ReactNode }) {
  const ref = useRef<View>(null);
  const [offset, setOffset] = useState(0);
  return (
    <View
      ref={ref}
      onLayout={() => ref.current?.measureInWindow((_x, y) => setOffset(Math.max(0, y)))}
      style={{ flex: 1 }}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={offset}
        style={{ flex: 1 }}
      >
        {children}
      </KeyboardAvoidingView>
    </View>
  );
}
