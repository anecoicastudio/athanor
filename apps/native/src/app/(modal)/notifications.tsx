import { useCallback, useEffect } from 'react';
import { ActivityIndicator, FlatList, RefreshControl } from 'react-native';
import { useRouter } from 'expo-router';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { semantic } from '@athanor/config';
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
import { Pressable, Text, View } from '@/tw';
import { ListState } from '@/components/ListState';
import { ModalHeader } from '@/components/ModalHeader';
import NotificationRow from '@/components/trust/NotificationRow';
import { SectionLabel } from '@/components/SectionLabel';
import { useAuth } from '@/lib/auth-context';
import { listState } from '@/lib/list-state';
import { devWarn } from '@/lib/log';
import { routeForNotification } from '@/lib/notification-route';
import { supabase } from '@/lib/supabase';

/**
 * In-app notification center (M9 §3.6). Grouped into Nuove (unread) + Prima (read).
 * Realtime: subscribe on mount → invalidate on change. «Segna lette» marks all read.
 * Tap → markRead (optimistic) + route to entity target. Presence dot, never a count (rule #3).
 * Neutral chrome; moment accent only on NotificationRow ndot (rule #4).
 * Zero hardcoded strings (rule #5). No glow on any surface here (rule #4).
 */
export default function NotificationsScreen() {
  const router = useRouter();
  const { profile } = useAuth();
  const locale = profile?.locale ?? 'it';
  const qc = useQueryClient();

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

  // ── Build flat section list ────────────────────────────────────────────────
  type Section = { kind: 'header'; label: string } | { kind: 'row'; item: Notification };
  const sections: Section[] = [];
  if (unreadItems.length > 0) {
    sections.push({ kind: 'header', label: t('notif.group.new', locale) });
    unreadItems.forEach((item) => sections.push({ kind: 'row', item }));
  }
  if (earlierItems.length > 0) {
    sections.push({ kind: 'header', label: t('notif.group.earlier', locale) });
    earlierItems.forEach((item) => sections.push({ kind: 'row', item }));
  }

  return (
    <View className="flex-1 bg-background">
      {/* Header: back + title + «Segna lette» + gear → prefs */}
      <ModalHeader
        title={t('notif.title', locale)}
        backLabel={t('common.back', locale)}
        right={
          <View className="flex-row items-center gap-4">
            {unreadItems.length > 0 ? (
              <Pressable
                onPress={() => markAll.mutate()}
                disabled={markAll.isPending}
                accessibilityRole="button"
                hitSlop={8}
              >
                <Text className="text-[13px] text-muted-foreground">
                  {t('notif.markAll', locale)}
                </Text>
              </Pressable>
            ) : null}
            {/* Overflow → preferences. Gear character (settings icon) */}
            <Pressable
              onPress={() => router.push('/(modal)/notif-prefs')}
              accessibilityRole="button"
              accessibilityLabel={t('notif.prefs.title', locale)}
              hitSlop={8}
            >
              <Text className="text-[18px] text-muted-foreground">⚙</Text>
            </Pressable>
          </View>
        }
      />

      <FlatList
        data={sections}
        keyExtractor={(section, idx) => (section.kind === 'header' ? `h-${idx}` : section.item.id)}
        contentContainerClassName="pb-10"
        refreshControl={
          <RefreshControl
            refreshing={query.isRefetching}
            onRefresh={() => void query.refetch()}
            tintColor={semantic.foregroundMuted}
          />
        }
        renderItem={({ item: section }) => {
          if (section.kind === 'header') {
            return (
              <View className="px-5 pb-1 pt-4">
                <SectionLabel>{section.label}</SectionLabel>
              </View>
            );
          }
          return <NotificationRow item={section.item} locale={locale} onPress={onRow} />;
        }}
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
                <ActivityIndicator color={semantic.foregroundMuted} />
              </View>
            }
          />
        }
      />
    </View>
  );
}
