import { useEffect, useRef, useState } from 'react';
import { FlatList, RefreshControl } from 'react-native';
import { useRouter } from 'expo-router';
import { useInfiniteQuery } from '@tanstack/react-query';
import { type FeedCursor, getFeedPage, postKeys, subscribeNewPosts } from '@athanor/api';
import { semantic } from '@athanor/config';
import { type MessageKey, t } from '@athanor/i18n';
import { Pressable, Text, View } from '@/tw';
import { CategoryTabs, type FeedFilter } from '@/components/feed/CategoryTabs';
import { FeedPost } from '@/components/feed/FeedPost';
import { FeedSkeleton } from '@/components/feed/FeedSkeleton';
import { EmptyState } from '@/components/EmptyState';
import { useAuth } from '@/lib/auth-context';
import { supabase } from '@/lib/supabase';

const COMPOSE_HREF = '/(modal)/post-compose' as const;

export default function CommunityScreen() {
  const { profile, session } = useAuth();
  const router = useRouter();
  const [filter, setFilter] = useState<FeedFilter>('all');
  const [hasNew, setHasNew] = useState(false);
  const locale = profile?.locale ?? 'it';

  const query = useInfiniteQuery({
    queryKey: postKeys.feed(filter),
    queryFn: ({ pageParam }) =>
      getFeedPage(supabase, { category: filter, cursor: pageParam as FeedCursor | null }),
    initialPageParam: null as FeedCursor | null,
    getNextPageParam: (last) => last.nextCursor,
  });

  const posts = query.data?.pages.flatMap((p) => p.posts) ?? [];

  const filterRef = useRef(filter);
  filterRef.current = filter;
  const myId = session?.user.id;

  // Realtime: "Nuovi passi ›" banner — skip your own posts and posts outside the
  // active category (deferred refinement). subscribeNewPosts returns its cleanup.
  useEffect(() => {
    const unsubscribe = subscribeNewPosts(supabase, (post) => {
      if (myId && post.author_id === myId) return;
      const active = filterRef.current;
      if (active !== 'all' && post.category !== active) return;
      setHasNew(true);
    });
    return unsubscribe;
  }, [myId]);

  const onRefresh = () => {
    setHasNew(false);
    void query.refetch();
  };

  if (query.isLoading) {
    return (
      <View className="flex-1 bg-background pt-12">
        <FeedSkeleton />
      </View>
    );
  }

  if (query.isError) {
    return (
      <View className="flex-1 items-center justify-center gap-4 bg-background px-5">
        <EmptyState>{t('feed.error', locale)}</EmptyState>
        <Pressable
          className="rounded-ctl border border-aura-line bg-aura-soft px-5 py-2"
          onPress={onRefresh}
        >
          <Text className="text-[13px] text-aura">{t('feed.retry', locale)}</Text>
        </Pressable>
      </View>
    );
  }

  const emptyTitle =
    filter === 'all'
      ? t('feed.empty.title', locale)
      : t('feed.empty.cat.title', locale, {
          cat: t(`feed.filter.${filter}` as MessageKey, locale),
        });
  const emptyCta = filter === 'all' ? t('feed.empty.cta', locale) : t('feed.empty.cat.cta', locale);

  return (
    <View className="flex-1 bg-background">
      <FlatList
        data={posts}
        keyExtractor={(item) => item.id}
        ListHeaderComponent={
          <View className="gap-4 py-4">
            <Pressable
              className="mx-5 rounded-card border border-hair bg-raise px-5 py-4"
              onPress={() => router.push(COMPOSE_HREF)}
            >
              <Text className="text-[14px] text-faint">
                {t('community.compose.prompt', locale)}
              </Text>
            </Pressable>
            <CategoryTabs active={filter} onChange={setFilter} locale={locale} />
            {hasNew ? (
              <Pressable
                className="mx-5 items-center rounded-ctl bg-aura-soft py-2"
                onPress={onRefresh}
              >
                <Text className="text-[13px] text-aura">{t('feed.newPosts', locale)}</Text>
              </Pressable>
            ) : null}
          </View>
        }
        renderItem={({ item }) => (
          <View className="px-5 pb-4">
            <FeedPost post={item} locale={locale} />
          </View>
        )}
        ListEmptyComponent={
          <View className="items-center gap-4 px-5 pt-16">
            <EmptyState>{emptyTitle}</EmptyState>
            <Pressable
              className="rounded-ctl border border-aura-line bg-aura-soft px-5 py-2"
              onPress={() => router.push(COMPOSE_HREF)}
            >
              <Text className="text-[13px] text-aura">{emptyCta}</Text>
            </Pressable>
          </View>
        }
        refreshControl={
          <RefreshControl
            refreshing={query.isRefetching}
            onRefresh={onRefresh}
            tintColor={semantic.aura}
          />
        }
        onEndReachedThreshold={0.5}
        onEndReached={() => {
          if (query.hasNextPage && !query.isFetchingNextPage) void query.fetchNextPage();
        }}
        contentContainerClassName="pb-[104px]"
      />
    </View>
  );
}
