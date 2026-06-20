import { Pressable, Text, View } from '@/tw';
import { HIT_SLOP } from '@/lib/a11y';
import { Avatar } from '@/components/Avatar';
import type { BlockedListItem } from '@athanor/schemas';

/**
 * Single row in the blocked-profiles list (M9). Neutral palette — no cyan/glow
 * (rule #4); the "Sblocca" control is a quiet secondary action, not a primary CTA.
 * Dims to 50 % opacity while the mutation is in flight so the user can see
 * processing without losing context.
 */
export function BlockedRow({
  item,
  unblockLabel,
  mutating,
  onUnblock,
}: {
  item: BlockedListItem;
  unblockLabel: string;
  mutating: boolean;
  onUnblock: () => void;
}) {
  return (
    <View className="flex-row items-center gap-3 py-3" style={{ opacity: mutating ? 0.5 : 1 }}>
      <Avatar handle={item.peerHandle} size={40} />
      <Text className="flex-1 text-foreground">{item.peerHandle ?? '—'}</Text>
      <Pressable
        onPress={onUnblock}
        disabled={mutating}
        accessibilityRole="button"
        hitSlop={HIT_SLOP}
      >
        <Text className="text-[13px] text-muted-foreground">{unblockLabel}</Text>
      </Pressable>
    </View>
  );
}
