import { useEffect, useState } from 'react';
import { t } from '@athanor/i18n';
import type { Locale } from '@athanor/schemas';
import { unreadPresence, subscribeNotifications } from '@athanor/api';
import { Pressable, Text, View } from '@/tw';
import { supabase } from '@/lib/supabase';
import { HIT_SLOP } from '@/lib/a11y';
import { devWarn } from '@/lib/log';
import { BellIcon, MessageIcon, SearchIcon } from '@/components/glyphs';

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
        .catch((e) => devWarn('[home] unreadPresence refresh', e));
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
      {/* flex-1 + numberOfLines: handles run to 30 chars, and Yoga's default
        flexShrink of 0 would push the icon cluster off-screen instead of
        truncating. gap-6 keeps the icons' HIT_SLOP rects (11px per side) from
        overlapping each other.
        Two lines, not one (#639): flex-1 is what protects the icon cluster, and the line
        count only decides whether an over-long handle truncates or wraps. 28px is the
        largest type on this screen, so Dynamic Type reaches it first — at AX sizes one
        line left «@mar…» where the member's own name should be. */}
      <View className="flex-1 gap-0.5">
        <Text className="text-[13px] text-faint" numberOfLines={2}>
          {greeting}
        </Text>
        {handle ? (
          <Text
            className="text-[28px] font-bold tracking-[-0.02em] text-foreground"
            numberOfLines={2}
          >
            @{handle}
          </Text>
        ) : null}
      </View>
      <View className="shrink-0 flex-row items-center gap-6 pt-1">
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
