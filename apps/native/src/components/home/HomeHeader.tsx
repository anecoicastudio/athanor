import { useEffect, useState } from 'react';
import { useWindowDimensions } from 'react-native';
import { t } from '@athanor/i18n';
import type { Locale } from '@athanor/schemas';
import { unreadPresence, subscribeNotifications } from '@athanor/api';
import { galleria } from '@athanor/config';
import { Pressable, Text, View, cn } from '@/tw';
import { supabase } from '@/lib/supabase';
import { devWarn } from '@/lib/log';
import { PRESS_DIM } from '@/lib/press';
import { stacksTrailing } from '@/lib/type-scale';
import { BellIcon, MessageIcon, SearchIcon } from '@/components/glyphs';

/**
 * Home greeting header (PRD 01-m1-identity §3.2, block 1). Time-of-day greeting
 * + the person's @handle (profiles has no `name` column), and three action
 * icons. `messages` opens the conversations list (M5); search (M8) routes to the
 * search modal; notifications (M9) routes to the center.
 *
 * The greeting is the title (24/600) and the handle the grey line under it, as the prototype
 * draws the row (#921, 2026-10-05); before that the handle was the large line.
 *
 * Bell carries a presence dot (8px, foreground) when unread notifications exist. It is not
 * cyan: the cyan dot is the waiting Momento's, and this one lights for any unread notification
 * (Marco, 2026-10-05). A 2px ring in the stage colour keeps it apart from the bell's line.
 * No numeric badge — ever (Foundation §8 / rule #3). The dot is live-updated via
 * `subscribeNotifications` realtime subscription; cleaned up on unmount.
 *
 * At the accessibility text sizes (`stacksTrailing`, `lib/type-scale.ts`) the three controls
 * take a line of their own above the greeting. Seen on 2026-10-05 on the iPhone SE simulator
 * at AX5: beside them the greeting had 191pt and broke inside the word, «Buonaser / a».
 *
 * Each control is a 44pt box with a 22 drawing centred in it (DESIGN §10), the recipe of
 * `ModalHeader`'s `HeaderIcon`, and no longer a bare glyph reaching 44 through `hitSlop`.
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
  const stacked = stacksTrailing(useWindowDimensions().fontScale);

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

  // flex-1 + numberOfLines: handles run to 30 chars, and Yoga's default flexShrink of 0 would
  // push the icon cluster off-screen instead of truncating.
  // The greeting takes two lines (#639): it is prose, and flex-1 is what protects the icon
  // cluster. The HANDLE takes one (#754): it is a single word, so a second line could only
  // split it — «@marco_acc / ardi» at AX5. It ellipsizes instead, and the label keeps the whole
  // handle; no font cap (DESIGN §10).
  const title = (
    <View className={stacked ? 'gap-0.5' : 'flex-1 gap-0.5'}>
      <Text className="type-title text-foreground" numberOfLines={2}>
        {greeting}
      </Text>
      {handle ? (
        <Text
          className="type-small text-muted-foreground"
          accessibilityLabel={`@${handle}`}
          numberOfLines={1}
        >
          @{handle}
        </Text>
      ) : null}
    </View>
  );
  // The boxes touch, and the last one is pulled 11 into the gutter so its drawing stands on
  // the 20pt edge (44 box, 22 drawing).
  const controls = (
    <View className={cn('-mr-[11px] shrink-0 flex-row items-center', stacked && 'self-end')}>
      {actions.map(({ key, label, Icon, dot }) => (
        <Pressable
          key={key}
          accessibilityRole="button"
          accessibilityLabel={label}
          onPress={() => onAction(key)}
          className={cn('min-h-[44px] min-w-[44px] items-center justify-center', PRESS_DIM)}
        >
          {/* Presence dot sits top-right of the icon; never a number (rule #3) */}
          <View
            className="relative"
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
          >
            <Icon color={galleria.foreground} />
            {dot ? (
              // A 2px ring in the stage colour holds the dot apart from the bell's own
              // line: both are foreground.
              <View className="absolute -right-1 -top-1 rounded-full bg-background p-0.5">
                <View className="h-2 w-2 rounded-full bg-foreground" />
              </View>
            ) : null}
          </View>
        </Pressable>
      ))}
    </View>
  );

  // At the accessibility text sizes the controls stand above the greeting, and they come first
  // in the tree too: the order of the elements is the order on screen in both layouts.
  return stacked ? (
    <View className="gap-2">
      {controls}
      {title}
    </View>
  ) : (
    <View className="min-h-[44px] flex-row items-center justify-between gap-2">
      {title}
      {controls}
    </View>
  );
}
