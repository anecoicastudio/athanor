import { Text, View } from '@/tw';
import { Screen } from '@/components/Screen';

/**
 * The centered ✦ that every screen renders while its first read is in flight.
 *
 * It existed in six copies, five of them byte-identical and the sixth — `(tabs)/index.tsx`
 * — the only one that hid the glyph from assistive tech. That sixth is the correct one and
 * is what this component renders: ✦ is decoration, and a screen reader announcing a lone
 * "black four pointed star" tells the member nothing about what is loading.
 *
 * `nested` is for a screen that is ALREADY inside a `Screen` and wants the remaining
 * content region filled (`help.tsx`'s picker step, below its `ModalHeader`). It is a prop
 * rather than a second component because the reason not to nest is specific: a `Screen`
 * inside a `Screen` mounts a second `ToastViewport`, and `ToastHost` elects the
 * most-recently-registered viewport — so the inner one would win the election and then
 * unmount the moment the load finished.
 */
export function LoadingScreen({ nested = false }: { nested?: boolean }) {
  const mark = (
    <Text
      className="text-2xl text-muted-foreground"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      ✦
    </Text>
  );

  return nested ? (
    <View className="flex-1 items-center justify-center">{mark}</View>
  ) : (
    <Screen className="items-center justify-center">{mark}</Screen>
  );
}
