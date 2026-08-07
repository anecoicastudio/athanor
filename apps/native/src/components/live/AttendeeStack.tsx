import { View, Text } from '@/tw';
import { Avatar } from '@/components/Avatar';
import { useProfile } from '@/hooks/use-profile';
import { t } from '@athanor/i18n';

function AttendeeAvatar({ userId }: { userId: string }) {
  const { data } = useProfile(userId);
  return (
    <View className="rounded-full border border-background">
      <Avatar handle={data?.handle ?? null} size={28} />
    </View>
  );
}

/** Up to 4 overlapping attendee avatars + a +N overflow chip. count is the total 'going'. */
export function AttendeeStack({
  userIds,
  count,
  locale,
}: {
  userIds: string[];
  count: number;
  locale: 'it' | 'en';
}) {
  if (count === 0) return null;
  const shown = userIds.slice(0, 4);
  const overflow = count - shown.length;
  return (
    <View
      className="flex-row items-center gap-2"
      accessibilityLabel={t('event.attendeesShort', locale, { n: count })}
    >
      <View className="flex-row">
        {shown.map((id, i) => (
          <View key={id} style={{ marginLeft: i === 0 ? 0 : -10 }}>
            <AttendeeAvatar userId={id} />
          </View>
        ))}
      </View>
      {overflow > 0 ? (
        <View className="rounded-full bg-surface-muted px-2 py-1">
          <Text className="text-[12px] text-ink-2">+{overflow}</Text>
        </View>
      ) : null}
    </View>
  );
}
