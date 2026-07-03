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
import { EmptyState } from '@/components/EmptyState';
import NotificationRow from '@/components/trust/NotificationRow';
import { useAuth } from '@/lib/auth-context';
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
    queryFn: ({ pageParam }) =>
      listNotifications(supabase, pageParam as NotifCursor | undefined),
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
      markRead(supabase, n.id).catch(() => {});
      void qc.invalidateQueries({ queryKey: notifKeys.all });
      routeFor(n, router);
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
      <View className="flex-row items-center justify-between gap-3 px-5 pb-4 pt-14">
        <View className="flex-row items-center gap-3">
          <Pressable
            onPress={() => router.back()}
            accessibilityRole="button"
            accessibilityLabel={t('common.back', locale)}
            hitSlop={8}
          >
            <Text className="text-2xl text-foreground">‹</Text>
          </Pressable>
          <Text className="text-[17px] font-semibold text-foreground">
            {t('notif.title', locale)}
          </Text>
        </View>
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
      </View>

      <FlatList
        data={sections}
        keyExtractor={(section, idx) =>
          section.kind === 'header' ? `h-${idx}` : section.item.id
        }
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
                <Text className="text-[11px] font-semibold uppercase tracking-[0.16em] text-faint">
                  {section.label}
                </Text>
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
          query.isLoading ? (
            <View className="items-center pt-24">
              <ActivityIndicator color={semantic.foregroundMuted} />
            </View>
          ) : (
            <View className="items-center px-8 pt-24">
              <EmptyState>{t('notif.empty', locale)}</EmptyState>
            </View>
          )
        }
      />
    </View>
  );
}

/** Route to the appropriate section for a tapped notification. Best-effort — producers deferred. */
function routeFor(n: Notification, router: ReturnType<typeof useRouter>) {
  const ref = n.entity_ref as { kind?: string; id?: string } | null | undefined;
  switch (n.type) {
    case 'moment':
      return router.push('/(modal)/match');
    case 'review':
      return router.push('/(tabs)/profile');
    case 'dreamMilestone':
      return router.push('/(tabs)/profile');
    case 'eventReminder':
      if (ref?.id) {
        // event/[id]/index is the event detail route
        return router.push(`/(modal)/event/${ref.id}` as Parameters<typeof router.push>[0]);
      }
      return undefined;
    case 'fundMilestone':
      return router.push('/(modal)/annual');
    case 'projectResponse':
      return router.push('/(tabs)/costellazioni');
    case 'connection':
      return router.push('/(modal)/connections');
    default:
      return undefined;
  }
}
