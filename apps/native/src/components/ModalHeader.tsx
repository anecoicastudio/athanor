import type { ReactNode } from 'react';
import { useRouter } from 'expo-router';
import { Pressable, Text, View } from '@/tw';
import { HIT_SLOP } from '@/lib/a11y';

/**
 * Canonical modal/screen header (DESIGN §4 h1 = 24/600): back chevron ‹ in
 * foreground + semibold title + optional right-side slot. One recipe for
 * every pushed screen — don't hand-roll headers (chevron size/color and
 * title weight drifted across 3 clusters before this existed).
 *
 * `backLabel` / `title` arrive already translated (zero i18n keys here).
 * Pass `onBack` to override the default router.back() (e.g. dismissTo).
 */
export function ModalHeader({
  title,
  backLabel,
  onBack,
  right,
}: {
  title: string;
  backLabel: string;
  onBack?: () => void;
  right?: ReactNode;
}) {
  const router = useRouter();
  return (
    <View className="flex-row items-center gap-3 px-5 pb-3 pt-14">
      <Pressable
        onPress={onBack ?? (() => router.back())}
        hitSlop={HIT_SLOP}
        accessibilityRole="button"
        accessibilityLabel={backLabel}
      >
        <Text className="text-2xl text-foreground">‹</Text>
      </Pressable>
      <Text
        accessibilityRole="header"
        numberOfLines={1}
        className="flex-1 text-2xl font-semibold text-foreground"
      >
        {title}
      </Text>
      {right}
    </View>
  );
}
