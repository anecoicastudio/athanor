import { Pressable, Text, View } from '@/tw';
import { t, type MessageKey } from '@athanor/i18n';
import type { Locale, StarKey } from '@athanor/schemas';

/**
 * One cell of the Six Stars grid.
 * - earned → filled ✦ (`text-aura`) with `bg-aura-soft` + `border-aura-line` inset.
 * - own-unearned → outline ✧ (`text-faint`) + plain `bg-raise`, tappable.
 * - other's unearned → `null` (hidden — rule #3: no vanity "what they're missing").
 */
export function StarCell({
  starId,
  earned,
  viewerIsOwner,
  locale,
  onPress,
}: {
  starId: StarKey;
  earned: boolean;
  viewerIsOwner: boolean;
  locale: Locale;
  onPress?: () => void;
}) {
  const name = t(`star.${starId}` as MessageKey, locale);
  const stateWord = t(earned ? 'star.lit' : 'star.unlit', locale);

  // Others' unearned stars are hidden (rule #3).
  if (!earned && !viewerIsOwner) return null;

  if (earned) {
    return (
      <View
        className="w-1/3 items-center gap-1.5 py-3"
        accessibilityRole="image"
        accessibilityLabel={`${name}, ${stateWord}`}
      >
        <View className="items-center justify-center rounded-full border border-aura-line bg-aura-soft p-2">
          <Text className="text-2xl text-aura">✦</Text>
        </View>
        <Text className="text-[11px] tracking-wide text-aura">{name}</Text>
      </View>
    );
  }

  // own-unearned: tappable
  return (
    <Pressable
      className="w-1/3 items-center gap-1.5 py-3"
      accessibilityRole="button"
      accessibilityLabel={`${name}, ${stateWord}`}
      onPress={onPress}
    >
      <View className="items-center justify-center rounded-full bg-raise p-2">
        <Text className="text-2xl text-faint">✧</Text>
      </View>
      <Text className="text-[11px] tracking-wide text-faint">{name}</Text>
    </Pressable>
  );
}
