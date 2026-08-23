import { useEffect, useRef, useState } from 'react';
import { RefreshControl } from 'react-native';
import { useRouter } from 'expo-router';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import {
  type FeedCursor,
  getFeedPage,
  getStoryRail,
  postKeys,
  storyKeys,
  subscribeNewPosts,
  subscribeNewStories,
} from '@athanor/api';
import { semantic } from '@athanor/config';
import { type MessageKey, t } from '@athanor/i18n';
import { FlatList, Pressable, Text, View } from '@/tw';
import { HIT_SLOP } from '@/lib/a11y';
import { Screen } from '@/components/Screen';
import { CategoryTabs } from '@/components/feed/CategoryTabs';
import { EventsFeedList } from '@/components/feed/EventsFeedList';
import { FeedPost } from '@/components/feed/FeedPost';
import { FeedSkeleton } from '@/components/feed/FeedSkeleton';
import { EVENT_HREF } from '@/components/live/EventRow';
import { EmptyState } from '@/components/EmptyState';
import { ListState } from '@/components/ListState';
import { StoryRail } from '@/components/stories/StoryRail';
import { useAuth } from '@/lib/auth-context';
import { type FeedTab, postsFilter } from '@/lib/feed-tabs';
import { useLocale } from '@/hooks/use-locale';
import { useStorySeen } from '@/hooks/use-story-seen';
import { supabase } from '@/lib/supabase';
import { usePersonStory } from '@/hooks/use-person-story';

const COMPOSE_HREF = '/(modal)/post-compose' as const;
const STORY_COMPOSE_HREF = '/(modal)/story-compose' as const;
const LIVE_HREF = '/(modal)/live' as const;
const EVENT_CREATE_HREF = '/(modal)/event-create' as const;

export default function CommunityScreen() {
  const { profile, session } = useAuth();
  const router = useRouter();
  const [tab, setTab] = useState<FeedTab>('all');
  const [hasNew, setHasNew] = useState(false);
  const locale = useLocale();

  // `null` on the «Eventi» tab: it has no posts source (#153), so the posts query stands down
  // and `EventsFeedList` draws instead. The key keeps its last legal value rather than
  // inventing one — the query is disabled, so nothing is read under it.
  const postsCategory = postsFilter(tab);
  const showsPosts = postsCategory !== null;

  const query = useInfiniteQuery({
    queryKey: postKeys.feed(postsCategory ?? 'all'),
    queryFn: ({ pageParam }) =>
      getFeedPage(supabase, {
        category: postsCategory ?? 'all',
        cursor: pageParam as FeedCursor | null,
      }),
    initialPageParam: null as FeedCursor | null,
    getNextPageParam: (last) => last.nextCursor,
    enabled: showsPosts,
  });

  const posts = query.data?.pages.flatMap((p) => p.posts) ?? [];

  const tabRef = useRef(tab);
  tabRef.current = tab;
  const myId = session?.user.id;

  // Realtime: "Nuovi passi ›" banner — skip your own posts and posts outside the
  // active category (deferred refinement). subscribeNewPosts returns its cleanup.
  useEffect(() => {
    const unsubscribe = subscribeNewPosts(supabase, (post) => {
      if (myId && post.author_id === myId) return;
      // `?? 'all'`: the events tab does not narrow posts, so it does not filter this either.
      // The flag keeps recording while the member browses events — the banner is hidden there
      // (its render is posts-only), and it is waiting for them when they come back. Suppressing
      // the flag instead would lose every post that arrived while the tab was open.
      const active = postsFilter(tabRef.current) ?? 'all';
      if (active !== 'all' && post.category !== active) return;
      setHasNew(true);
    });
    return unsubscribe;
  }, [myId]);

  const railQuery = useQuery({
    queryKey: storyKeys.rail(),
    queryFn: () => getStoryRail(supabase),
  });
  // Persisted, shared with the viewer — a ring dims when a story FINISHES, not on tap (#298).
  const { seenIds } = useStorySeen();

  // Own live-segment presence drives the «Il tuo passo» ring (#298): with a live segment it
  // opens the viewer (and the chain), without one it opens the composer. Also warms
  // storyKeys.person(myId) so the viewer's session can include you without a refetch.
  const myStoryQuery = usePersonStory(myId);
  const myHasLive = (myStoryQuery.data?.segments ?? []).some(
    (s) => !s.deleted_at && new Date(s.expires_at).getTime() > Date.now(),
  );

  // Realtime: a new story segment → refresh the rail (skip your own insert).
  useEffect(() => {
    const unsubscribe = subscribeNewStories(supabase, (seg) => {
      if (myId && seg.author_id === myId) return;
      void railQuery.refetch();
    });
    return unsubscribe;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myId]);

  const openPerson = (authorId: string) => {
    const handle =
      authorId === 'me'
        ? (profile?.handle ?? '')
        : (railQuery.data?.find((p) => p.author_id === authorId)?.handle ?? '');
    router.push({ pathname: '/(modal)/stories', params: { authorId, handle } });
  };

  const onRefresh = () => {
    setHasNew(false);
    void query.refetch();
  };

  if (showsPosts && query.isLoading) {
    return (
      <Screen className="pt-4">
        <FeedSkeleton />
      </Screen>
    );
  }

  if (showsPosts && query.isError) {
    return (
      <Screen>
        <ListState
          state="error"
          locale={locale}
          errorLabel={t('feed.error', locale)}
          onRetry={onRefresh}
          className="flex-1 justify-center px-5"
        />
      </Screen>
    );
  }

  const header = (
    <View className="gap-4 py-4">
      {/* h1 + compose, per DESIGN §8.3 — the in-content header (§6 → Screen headers). */}
      <View className="flex-row items-center justify-between gap-3 px-5">
        <Text
          accessibilityRole="header"
          className="flex-1 text-2xl font-semibold text-foreground"
          numberOfLines={1}
        >
          {t('community.title', locale)}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('community.compose.prompt', locale)}
          hitSlop={HIT_SLOP}
          onPress={() => router.push(COMPOSE_HREF)}
        >
          <Text className="text-2xl text-faint">+</Text>
        </Pressable>
      </View>
      <Pressable
        className="mx-5 rounded-card border border-hair bg-raise px-5 py-4"
        onPress={() => router.push(COMPOSE_HREF)}
      >
        <Text className="text-[14px] text-faint">{t('community.compose.prompt', locale)}</Text>
      </Pressable>
      <CategoryTabs active={tab} onChange={setTab} locale={locale} />
      <Pressable
        className="mx-5 flex-row items-center justify-between rounded-card border border-hair bg-raise px-5 py-3"
        onPress={() => router.push(LIVE_HREF)}
        accessibilityRole="link"
      >
        <Text className="text-[14px] text-foreground">{t('live.title', locale)}</Text>
        <Text className="text-[13px] text-aura">{t('home.today.seeLive', locale)}</Text>
      </Pressable>
      {railQuery.data && (railQuery.data.length > 0 || profile?.handle) ? (
        <StoryRail
          you={{
            handle: profile?.handle ?? null,
            displayName: profile?.display_name ?? null,
            avatarPath: profile?.avatar_path ?? null,
            hasStory: myHasLive,
            seen: myHasLive ? (myId ? seenIds.has(myId) : true) : true,
          }}
          people={railQuery.data ?? []}
          seenIds={seenIds}
          locale={locale}
          onOpenPerson={openPerson}
          onAddYours={() => router.push(STORY_COMPOSE_HREF)}
        />
      ) : null}
      {/* Posts-only: `hasNew` set under a post tab survives a switch to «Eventi», and
          «Nuovi passi ›» over a list of events would be a banner about the wrong thing.
          The subscription itself keeps running — it costs nothing and the flag is still
          true when the member comes back. */}
      {hasNew && showsPosts ? (
        <Pressable className="mx-5 items-center rounded-ctl bg-aura-soft py-2" onPress={onRefresh}>
          <Text className="text-[13px] text-aura">{t('feed.newPosts', locale)}</Text>
        </Pressable>
      ) : null}
    </View>
  );

  if (!showsPosts) {
    return (
      <Screen>
        <EventsFeedList
          locale={locale}
          header={header}
          onOpen={(id) => router.push(EVENT_HREF(id))}
          onCreate={() => router.push(EVENT_CREATE_HREF)}
        />
      </Screen>
    );
  }

  // Below the guard `postsCategory` is a FeedFilter: computing this above it would look up
  // `feed.filter.null` on every render of the events tab, for a string that is thrown away.
  const emptyTitle =
    postsCategory === 'all'
      ? t('feed.empty.title', locale)
      : t('feed.empty.cat.title', locale, {
          cat: t(`feed.filter.${postsCategory}` as MessageKey, locale),
        });
  const emptyCta =
    postsCategory === 'all' ? t('feed.empty.cta', locale) : t('feed.empty.cat.cta', locale);

  return (
    <Screen>
      <FlatList
        data={posts}
        keyExtractor={(item) => item.id}
        ListHeaderComponent={header}
        renderItem={({ item }) => (
          <View className="px-5 pb-4">
            <FeedPost post={item} locale={locale} />
          </View>
        )}
        ListEmptyComponent={
          <View className="items-center px-5 pt-16">
            {/* Ghost action per DESIGN §9 — the framed cyan pill this replaced spent the
                moment-grade surface (rule #4) on an empty feed (#119). */}
            <EmptyState action={{ label: emptyCta, onPress: () => router.push(COMPOSE_HREF) }}>
              {emptyTitle}
            </EmptyState>
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
        contentContainerClassName="pb-12"
      />
    </Screen>
  );
}
