import { View } from '@/tw';
import { MandorlaMark } from '@/components/MandorlaMark';
import { Screen } from '@/components/Screen';

/**
 * The centered outline mandorla that every screen renders while its first read is in flight
 * (DESIGN §5 «On mobile»; a ✦ until 2026-10-04).
 *
 * It existed in six copies, five of them byte-identical and the sixth — `(tabs)/index.tsx`
 * — the only one that hid the glyph from assistive tech. That sixth is the correct one and
 * is what this component renders: the mark is decoration, and a screen reader announcing it
 * tells the member nothing about what is loading. `MandorlaMark` hides itself.
 *
 * `nested` is for a screen that is ALREADY inside a `Screen` and wants the remaining
 * content region filled (`help.tsx`'s picker step, below its `ModalHeader`). It is a prop
 * rather than a second component because the reason not to nest is specific: a `Screen`
 * inside a `Screen` mounts a second `ToastViewport`, and `ToastHost` elects the
 * most-recently-registered viewport — so the inner one would win the election and then
 * unmount the moment the load finished.
 */
export function LoadingScreen({ nested = false }: { nested?: boolean }) {
  return nested ? (
    <View className="flex-1 items-center justify-center">
      <MandorlaMark />
    </View>
  ) : (
    <Screen className="items-center justify-center">
      <MandorlaMark />
    </Screen>
  );
}
