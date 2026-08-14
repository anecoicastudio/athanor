import type { Insets } from 'react-native';
import { useRouter } from 'expo-router';
import { memberLabel } from '@athanor/core';
import { Pressable, Text, View } from '@/tw';
import { Avatar } from '@/components/Avatar';
import { useProfile } from '@/hooks/use-profile';
import { t } from '@athanor/i18n';

function AttendeeAvatar({
  userId,
  locale,
  hitSlop,
}: {
  userId: string;
  locale: 'it' | 'en';
  hitSlop: Insets;
}) {
  const router = useRouter();
  const { data } = useProfile(userId);
  const name = memberLabel(data?.display_name, data?.handle) ?? '—';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t('connection.a11y.open', locale, { name })}
      hitSlop={hitSlop}
      onPress={() => router.push(`/(modal)/user/${userId}`)}
      className="rounded-full border border-background"
    >
      <Avatar
        handle={data?.handle ?? null}
        displayName={data?.display_name ?? null}
        avatarPath={data?.avatar_path ?? null}
        size={28}
      />
    </Pressable>
  );
}

/**
 * Up to 4 overlapping attendee avatars + a +N overflow chip. count is the total 'going'.
 * Each face taps through to that person's profile (#356).
 */
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
            {/* Vertical slop reaches the 44pt line (28pt face + 8pt each side). Horizontally,
                only the stack's unoverlapped OUTER edges get slop — interior edges stay
                face-width so neighboring faces' targets never collide. */}
            <AttendeeAvatar
              userId={id}
              locale={locale}
              hitSlop={{
                top: 8,
                bottom: 8,
                left: i === 0 ? 8 : 0,
                right: i === shown.length - 1 ? 8 : 0,
              }}
            />
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
