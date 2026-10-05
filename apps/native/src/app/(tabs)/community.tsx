import { useEffect, useRef, useState } from 'react';
import { RefreshControl, useWindowDimensions } from 'react-native';
import { useRouter } from 'expo-router';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  type FeedCursor,
  getFeedPage,
  getStoryRail,
  postKeys,
  storyKeys,
  subscribeNewPosts,
  subscribeNewStories,
} from '@athanor/api';
import { galleria } from '@athanor/config';
import { type MessageKey, t } from '@athanor/i18n';
import { FlatList, Pressable, Text, View, cn } from '@/tw';
import { Button } from '@/components/Button';
import { Screen } from '@/components/Screen';
import { CategoryTabs } from '@/components/feed/CategoryTabs';
import { EventsFeedList } from '@/components/feed/EventsFeedList';
import { FeedPost } from '@/components/feed/FeedPost';
import { FeedSkeleton } from '@/components/feed/FeedSkeleton';
import { EVENT_HREF } from '@/components/live/EventRow';
import { EmptyState } from '@/components/EmptyState';
import { AddIcon } from '@/components/glyphs';
import { ListState } from '@/components/ListState';
import { Row } from '@/components/Row';
import { RowGroup } from '@/components/RowGroup';
import { StoryRail } from '@/components/stories/StoryRail';
import { useAuth } from '@/lib/auth-context';
import { PRESS_DIM } from '@/lib/press';
import { stacksTrailing } from '@/lib/type-scale';
import { type FeedTab, postsFilter } from '@/lib/feed-tabs';
import { useNow } from '@/hooks/use-now';
import { useLocale } from '@/hooks/use-locale';
import { useStorySeen } from '@/hooks/use-story-seen';
import { supabase } from '@/lib/supabase';
import { personStoryQuery, usePersonStory } from '@/hooks/use-person-story';

const COMPOSE_HREF = '/(modal)/post-compose' as const;
const STORY_COMPOSE_HREF = '/(modal)/story-compose' as const;

/** A segment still live at `now` — the «Il tuo passo» ring's one question about your story. */
function hasLiveSegment(
  segments: readonly { deleted_at: string | null; expires_at: string }[] | undefined,
  now: number,
): boolean {
  return (segments ?? []).some((s) => !s.deleted_at && new Date(s.expires_at).getTime() > now);
}
const LIVE_HREF = '/(modal)/live' as const;
const EVENT_CREATE_HREF = '/(modal)/event-create' as const;

export default function CommunityScreen() {
  const { profile, session } = useAuth();
  const router = useRouter();
  const [tab, setTab] = useState<FeedTab>('all');
  const [hasNew, setHasNew] = useState(false);
  const locale = useLocale();
  const stacked = stacksTrailing(useWindowDimensions().fontScale);

  // `null` on the «Eventi» tab: it has no posts source (#153), so the posts query stands down
  // and `EventsFeedList` draws instead. The key falls back to `'all'` — a constant, not the tab
  // the member came from — and is never read under it, because the query is disabled.
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
  // Written from an effect, never during render (#691). The subscription below reads it from
  // a realtime callback that fires long after commit, so a value one commit late is not a
  // value this callback can observe.
  useEffect(() => {
    tabRef.current = tab;
  }, [tab]);
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
  // Persisted, shared with the viewer — a disc loses its ring when a story FINISHES, not on tap (#298).
  const { seenIds } = useStorySeen();

  // Own live-segment presence drives the «Il tuo passo» ring (#298): with a live segment it
  // opens the viewer (and the chain), without one it opens the composer. Also warms
  // storyKeys.person(myId) so the viewer's session can include you without a refetch.
  const myStoryQuery = usePersonStory(myId);
  // Ticking, not pinned: bottom-tabs keeps this tab mounted for the session, and a story that
  // expires while the member sits here must stop reading as live.
  const now = useNow(60_000);
  const myHasLive = hasLiveSegment(myStoryQuery.data?.segments, now);

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

  // The ring's tap waits for the own-story read (#749). On a fresh install nothing is cached,
  // `myHasLive` reads false until the first fetch answers, and a tap in that window opened the
  // composer over a live story. `isLoading`, not `isPending`: a query disabled for want of an id
  // is pending forever and would hold the ring shut. While it loads, the tap joins the in-flight
  // read (`fetchQuery` dedupes on the key) and routes on its answer; a failed read keeps the old
  // fallback, the composer. `holding` drops the repeat taps a wait invites.
  const queryClient = useQueryClient();
  const holding = useRef(false);
  const openYours = () => {
    const route = (live: boolean) => (live ? openPerson('me') : router.push(STORY_COMPOSE_HREF));
    if (!myStoryQuery.isLoading) return route(myHasLive);
    if (holding.current) return;
    holding.current = true;
    void queryClient
      .fetchQuery(personStoryQuery(myId))
      .then(
        (story) => route(hasLiveSegment(story.segments, Date.now())),
        () => route(false),
      )
      .finally(() => {
        holding.current = false;
      });
  };

  const onRefresh = () => {
    setHasNew(false);
    void query.refetch();
  };

  // The header is the prototype's column: 26 between its blocks (DESIGN §6), 20 of gutter. The
  // chip row keeps 6 above and below inside its own scroll view, so the 44pt target a 32pt
  // chip reaches through `hitSlop` stays inside the row's box; its neighbours take 20, not 26.
  const header = (
    <View className="pb-[26px] pt-4">
      {/* The tab's title (h1, DESIGN §6 «Screen headers») and the drawn `add` at its right.
          At the accessibility sizes the control goes under the title, in screen order, so the
          one word of the title is never cut to fit beside it. */}
      <View
        className={cn(
          'px-5',
          stacked ? 'items-start' : 'min-h-[44px] flex-row items-center justify-between gap-2',
        )}
      >
        <Text
          accessibilityRole="header"
          className={cn('type-h1 text-foreground', stacked ? null : 'flex-1')}
          numberOfLines={2}
        >
          {t('community.title', locale)}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('community.compose.prompt', locale)}
          onPress={() => router.push(COMPOSE_HREF)}
          // A 44pt box, pulled 12 right so the drawing stands near the gutter (the prototype's
          // `.ib.rt`); under the title it stands on the left gutter instead.
          className={cn(
            'min-h-[44px] min-w-[44px] items-center justify-center',
            stacked ? '-ml-3' : '-mr-3',
            PRESS_DIM,
          )}
        >
          <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
            <AddIcon color={galleria.foreground} />
          </View>
        </Pressable>
      </View>
      {/* No compose prompt card (#640): §8.3's recipe is `Community +` — the card pushed
          the same route with the same a11y label as the add control above it, and together
          with the Live row it spent 383pt of an SE fold on chrome before the first author's
          name. */}
      <View className="mt-5">
        <CategoryTabs active={tab} onChange={setTab} locale={locale} />
      </View>
      {/* Athanor Live folded into the «Eventi» tab (#640): a standalone row on every tab
          was fold-chrome; on the events tab it is context. A row in a group, not a card. */}
      {!showsPosts ? (
        <View className="mt-5 px-5">
          <RowGroup>
            <Row title={t('live.title', locale)} onPress={() => router.push(LIVE_HREF)} />
          </RowGroup>
        </View>
      ) : null}
      {railQuery.data && (railQuery.data.length > 0 || profile?.handle) ? (
        <View className={showsPosts ? 'mt-5' : 'mt-[26px]'}>
          <StoryRail
            you={{
              handle: profile?.handle ?? null,
              displayName: profile?.display_name ?? null,
              avatarPath: profile?.avatar_path ?? null,
              live: myHasLive,
              seen: myHasLive ? (myId ? seenIds.has(myId) : true) : true,
            }}
            people={railQuery.data ?? []}
            seenIds={seenIds}
            locale={locale}
            onOpenPerson={openPerson}
            onOpenYours={openYours}
            onAddYours={() => router.push(STORY_COMPOSE_HREF)}
          />
        </View>
      ) : null}
      {/* Posts-only: `hasNew` set under a post tab survives a switch to «Eventi», and
          «Nuovi passi ›» over a list of events would be a banner about the wrong thing.
          The subscription itself keeps running — it costs nothing and the flag is still
          true when the member comes back. */}
      {hasNew && showsPosts ? (
        <View className="mt-[26px] items-center px-5">
          <Button
            label={t('feed.newPosts', locale)}
            variant="outline"
            size="sm"
            onPress={onRefresh}
          />
        </View>
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

  // Both arms keep the header, so a cold switch back from «Eventi» does not take the tab row
  // away with it and strand the member mid-switch.
  if (query.isLoading) {
    return (
      <Screen>
        {header}
        <FeedSkeleton />
      </Screen>
    );
  }

  if (query.isError) {
    return (
      <Screen>
        {header}
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
          <View className="px-5 pb-[26px]">
            <FeedPost post={item} locale={locale} />
          </View>
        )}
        ListEmptyComponent={
          <View className="items-center px-5 pt-16">
            {/* The action is `EmptyState`'s text link (DESIGN §9 «Empty state»): an empty feed
                is the quietest block on the screen (#119). */}
            <EmptyState action={{ label: emptyCta, onPress: () => router.push(COMPOSE_HREF) }}>
              {emptyTitle}
            </EmptyState>
          </View>
        }
        refreshControl={
          <RefreshControl
            refreshing={query.isRefetching}
            onRefresh={onRefresh}
            tintColor={galleria.foreground}
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
