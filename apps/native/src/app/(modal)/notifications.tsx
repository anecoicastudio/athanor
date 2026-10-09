import { useCallback, useEffect } from 'react';
import { ActivityIndicator, RefreshControl, useWindowDimensions } from 'react-native';
import { useRouter } from 'expo-router';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { galleria } from '@athanor/config';
import { t } from '@athanor/i18n';
import {
  notifKeys,
  listNotifications,
  markAllRead,
  markRead,
  subscribeNotifications,
} from '@athanor/api';
import type { NotifCursor } from '@athanor/api';
import type { Notification } from '@athanor/schemas';
import { FlatList, Pressable, Text, View, cn } from '@/tw';
import { SettingsIcon } from '@/components/glyphs';
import { ListState } from '@/components/ListState';
import { ModalHeader } from '@/components/ModalHeader';
import NotificationRow from '@/components/trust/NotificationRow';
import { RowGroup } from '@/components/RowGroup';
import { SectionLabel } from '@/components/SectionLabel';
import { useLocale } from '@/hooks/use-locale';
import { listState } from '@/lib/list-state';
import { devWarn } from '@/lib/log';
import { routeForNotification } from '@/lib/notification-route';
import { PRESS_DIM } from '@/lib/press';
import { supabase } from '@/lib/supabase';
import { stacksTrailing } from '@/lib/type-scale';
import { Screen } from '@/components/Screen';

/**
 * In-app notification center (M9 §3.6). Two groups, Nuove (unread) and Prima (read), each a
 * grey label over one `RowGroup` (Galleria, 2026-10-06, #921): no card, 26 between the groups.
 * Realtime: subscribe on mount → invalidate on change. «Segna lette» marks all read.
 * Tap → markRead (optimistic) + route to entity target. Never a count (rule #3): the group a
 * row stands in says whether it was read.
 * The one cyan is the dot on a waiting Momento's row (`NotificationRow`); nothing glows.
 * Zero hardcoded strings (rule #5).
 *
 * Header: «Segna lette» is an underlined foreground link in a 44pt box and the gear a drawn
 * icon in a 44pt box, 8 apart as `ModalHeader` sets its band. At the accessibility sizes
 * (`stacksTrailing`) the link stands under the header, at the left: beside the title it would
 * leave «Notifiche» no room (#754).
 *
 * A group renders all of its loaded rows as one list item: the block's round corners and its
 * hairlines belong to `RowGroup`, which a row-per-item list cannot draw. Pages still load on
 * `onEndReached`.
 */
export default function NotificationsScreen() {
  const router = useRouter();
  const locale = useLocale();
  const qc = useQueryClient();
  const stacked = stacksTrailing(useWindowDimensions().fontScale);

  // ── Notification list (keyset, created_at desc) ───────────────────────────
  const query = useInfiniteQuery({
    queryKey: notifKeys.list(),
    queryFn: ({ pageParam }) => listNotifications(supabase, pageParam as NotifCursor | undefined),
    initialPageParam: undefined as NotifCursor | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });

  const items = query.data?.pages.flatMap((p) => p.items) ?? [];
  const unreadItems = items.filter((n) => n.read_at == null);
  const earlierItems = items.filter((n) => n.read_at != null);

  // ── Realtime: invalidate on any change ────────────────────────────────────
  useEffect(() => {
    const unsub = subscribeNotifications(supabase, () => {
      void qc.invalidateQueries({ queryKey: notifKeys.all });
    });
    return unsub;
  }, [qc]);

  // ── Mark all read ─────────────────────────────────────────────────────────
  const markAll = useMutation({
    mutationFn: () => markAllRead(supabase),
    onSuccess: () => void qc.invalidateQueries({ queryKey: notifKeys.all }),
  });

  // ── Tap handler: markRead + route ─────────────────────────────────────────
  const onRow = useCallback(
    (n: Notification) => {
      markRead(supabase, n.id).catch((e) => devWarn('[notifications] markRead', e));
      void qc.invalidateQueries({ queryKey: notifKeys.all });
      const href = routeForNotification(n);
      if (href) router.push(href as Parameters<typeof router.push>[0]);
    },
    [qc, router],
  );

  // ── The two groups ─────────────────────────────────────────────────────────
  type Section = { key: 'new' | 'earlier'; label: string; items: Notification[] };
  const sections: Section[] = [];
  if (unreadItems.length > 0) {
    sections.push({ key: 'new', label: t('notif.group.new', locale), items: unreadItems });
  }
  if (earlierItems.length > 0) {
    sections.push({ key: 'earlier', label: t('notif.group.earlier', locale), items: earlierItems });
  }

  const markAllLink =
    unreadItems.length > 0 ? (
      <Pressable
        onPress={() => markAll.mutate()}
        disabled={markAll.isPending}
        accessibilityRole="button"
        className={cn('min-h-[44px] justify-center', PRESS_DIM)}
      >
        <Text className="type-small text-foreground underline">{t('notif.markAll', locale)}</Text>
      </Pressable>
    ) : null;

  return (
    <Screen>
      {/* Header: back + title + «Segna lette» + gear → prefs */}
      <ModalHeader
        title={t('notif.title', locale)}
        backLabel={t('common.back', locale)}
        right={
          <View className="flex-row items-center gap-2">
            {stacked ? null : markAllLink}
            {/* Overflow → preferences. The sun-wheel is the app's gear (#753: a U+2699 text
                character here fell back to the emoji font). A 44pt box, pulled 12 into the
                gutter like `HeaderClose`. */}
            <Pressable
              onPress={() => router.push('/(modal)/notif-prefs')}
              accessibilityRole="button"
              accessibilityLabel={t('notif.prefs.title', locale)}
              className={cn(
                '-mr-3 min-h-[44px] min-w-[44px] items-center justify-center',
                PRESS_DIM,
              )}
            >
              <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
                <SettingsIcon size={22} color={galleria.foreground} />
              </View>
            </Pressable>
          </View>
        }
      />
      {stacked && markAllLink ? <View className="items-start px-5 pb-4">{markAllLink}</View> : null}

      <FlatList
        data={sections}
        keyExtractor={(section) => section.key}
        contentContainerClassName="grow gap-[26px] px-5 pb-12"
        refreshControl={
          <RefreshControl
            refreshing={query.isRefetching}
            onRefresh={() => void query.refetch()}
            tintColor={galleria.foregroundMuted}
          />
        }
        renderItem={({ item: section }) => (
          // `RowGroup`'s own label is not a heading; this one is (DESIGN §10), so the label
          // stands here, 12 above the block as `RowGroup` sets its own.
          <View className="gap-3">
            <SectionLabel heading>{section.label}</SectionLabel>
            <RowGroup>
              {section.items.map((item) => (
                <NotificationRow key={item.id} item={item} locale={locale} onPress={onRow} />
              ))}
            </RowGroup>
          </View>
        )}
        onEndReachedThreshold={0.5}
        onEndReached={() => {
          if (query.hasNextPage && !query.isFetchingNextPage) void query.fetchNextPage();
        }}
        ListEmptyComponent={
          <ListState
            state={listState({
              status: query.status,
              fetchStatus: query.fetchStatus,
              isEmpty: sections.length === 0,
              staleWins: true,
            })}
            locale={locale}
            errorLabel={t('notif.error', locale)}
            emptyLabel={t('notif.empty', locale)}
            onRetry={() => void query.refetch()}
            // `foregroundMuted`, not the `faint` default: this screen's RefreshControl above
            // uses the same tone, and two spinners a pull apart should not differ.
            loading={
              <View className="items-center pt-24">
                <ActivityIndicator color={galleria.foregroundMuted} />
              </View>
            }
          />
        }
      />
    </Screen>
  );
}
