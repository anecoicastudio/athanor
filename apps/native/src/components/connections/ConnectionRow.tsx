import { memberLabel } from '@athanor/core';
import { type Locale, t } from '@athanor/i18n';
import type { ConnectionListItem } from '@athanor/schemas';
import { Pressable, Text, View } from '@/tw';
import { Avatar } from '@/components/Avatar';

/**
 * One established connection in the Connessioni list: avatar + @handle, whole row
 * taps through to the peer's profile.
 */
export function ConnectionRow({
  item,
  locale,
  onPress,
}: {
  item: ConnectionListItem;
  locale: Locale;
  onPress: () => void;
}) {
  const name = memberLabel(item.peerDisplayName, item.peerHandle) ?? '—';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t('connection.a11y.open', locale, { name })}
      className="flex-row items-center gap-3 py-3"
      onPress={onPress}
    >
      <Avatar
        handle={item.peerHandle}
        displayName={item.peerDisplayName}
        avatarPath={item.peerAvatarPath}
        size={48}
      />
      <View className="flex-1">
        <Text className="text-[15px] font-semibold text-foreground">{name}</Text>
      </View>
    </Pressable>
  );
}
