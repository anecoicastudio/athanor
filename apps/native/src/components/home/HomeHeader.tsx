import { t } from '@athanor/i18n';
import type { Locale } from '@athanor/schemas';
import { Pressable, Text, View } from '@/tw';
import { BellIcon, MessageIcon, SearchIcon } from './icons';

/**
 * Home greeting header (PRD 01-m1-identity §3.2, block 1). Time-of-day greeting
 * + the person's @handle (profiles has no `name` column), and three action
 * icons. Targets land in later milestones (search M8, messages M5, notifiche
 * M9) → tapping signals «Presto qui» via `onAction`; no dead routes, and
 * **never a numeric badge** (Foundation §8 — the prototype's "3" is the mockup).
 */
export function HomeHeader({
  greeting,
  handle,
  locale,
  onAction,
}: {
  greeting: string;
  handle: string | null;
  locale: Locale;
  onAction: () => void;
}) {
  const actions = [
    { key: 'search', label: t('home.action.search', locale), Icon: SearchIcon },
    { key: 'messages', label: t('home.action.messages', locale), Icon: MessageIcon },
    { key: 'notifications', label: t('home.action.notifications', locale), Icon: BellIcon },
  ] as const;

  return (
    <View className="flex-row items-start justify-between gap-3">
      <View className="gap-0.5">
        <Text className="text-[13px] text-faint">{greeting}</Text>
        {handle ? (
          <Text className="text-3xl font-bold tracking-[-0.02em] text-foreground">@{handle}</Text>
        ) : null}
      </View>
      <View className="flex-row items-center gap-4 pt-1">
        {actions.map(({ key, label, Icon }) => (
          <Pressable
            key={key}
            accessibilityRole="button"
            accessibilityLabel={label}
            hitSlop={8}
            onPress={onAction}
          >
            <Icon />
          </Pressable>
        ))}
      </View>
    </View>
  );
}
