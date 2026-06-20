import { useEffect, useState } from 'react';
import { t } from '@athanor/i18n';
import type { Locale } from '@athanor/schemas';
import { unreadPresence, subscribeNotifications } from '@athanor/api';
import { Pressable, Text, View } from '@/tw';
import { supabase } from '@/lib/supabase';
import { HIT_SLOP } from '@/lib/a11y';
import { BellIcon, MessageIcon, SearchIcon } from './icons';

/**
 * Home greeting header (PRD 01-m1-identity §3.2, block 1). Time-of-day greeting
 * + the person's @handle (profiles has no `name` column), and three action
 * icons. `messages` opens the conversations list (M5); search (M8) routes to the
 * search modal; notifications (M9) routes to the center.
 *
 * Bell carries a presence dot (bg-aura, h-2 w-2) when unread notifications exist.
 * No numeric badge — ever (Foundation §8 / rule #3). The dot is live-updated via
 * `subscribeNotifications` realtime subscription; cleaned up on unmount.
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
  onAction: (key: 'search' | 'messages' | 'notifications') => void;
}) {
  // Presence dot: boolean, never a count (rule #3).
  const [hasUnread, setHasUnread] = useState(false);

  useEffect(() => {
    let cancelled = false;

    // Initial fetch
    unreadPresence(supabase)
      .then((v) => {
        if (!cancelled) setHasUnread(v);
      })
      .catch(() => {
        // silent — absence of dot is the safe fallback
      });

    // Live update via realtime
    const unsub = subscribeNotifications(supabase, () => {
      unreadPresence(supabase)
        .then((v) => {
          if (!cancelled) setHasUnread(v);
        })
        .catch(() => {});
    });

    return () => {
      cancelled = true;
      unsub();
    };
  }, []);

  const actions = [
    { key: 'search', label: t('home.action.search', locale), Icon: SearchIcon, dot: false },
    { key: 'messages', label: t('home.action.messages', locale), Icon: MessageIcon, dot: false },
    {
      key: 'notifications',
      label: t('home.action.notifications', locale),
      Icon: BellIcon,
      dot: hasUnread,
    },
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
        {actions.map(({ key, label, Icon, dot }) => (
          <Pressable
            key={key}
            accessibilityRole="button"
            accessibilityLabel={label}
            hitSlop={HIT_SLOP}
            onPress={() => onAction(key)}
          >
            {/* Presence dot sits top-right of the icon; never a number (rule #3) */}
            <View className="relative">
              <Icon />
              {dot ? (
                <View className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-aura" />
              ) : null}
            </View>
          </Pressable>
        ))}
      </View>
    </View>
  );
}
