import { useEffect, useRef, useState } from 'react';
import { Alert, type FlatList as RNFlatList } from 'react-native';
import * as Crypto from 'expo-crypto';
import { KeyboardAvoiding } from '@/components/KeyboardAvoiding';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { InfiniteData } from '@tanstack/react-query';
import {
  addComment,
  type CommentCursor,
  type CommentPage,
  getAuthorReactionCount,
  getCommentsPage,
  getPostById,
  getViewerReaction,
  postKeys,
  softDeleteComment,
  softDeletePost,
  subscribeComments,
  togglePostReaction,
} from '@athanor/api';
import { semantic } from '@athanor/config';
import { type MessageKey, t } from '@athanor/i18n';
import type { PostComment } from '@athanor/schemas';
import { FlatList, Pressable, Text, TextInput, View } from '@/tw';
import { ListState } from '@/components/ListState';
import { ModalHeader } from '@/components/ModalHeader';
import { Toast } from '@/components/Toast';
import { Comment } from '@/components/feed/Comment';
import { PostAuthorRow } from '@/components/feed/PostAuthorRow';
import { PostMedia } from '@/components/feed/PostMedia';
import { ReactionStar } from '@/components/feed/ReactionStar';
import { useAuth } from '@/lib/auth-context';
import { prependComment } from '@/lib/comment-cache';
import { listState } from '@/lib/list-state';
import { supabase } from '@/lib/supabase';
import { Screen } from '@/components/Screen';

export default function PostDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { profile, session } = useAuth();
  const router = useRouter();
  const queryClient = useQueryClient();
  const locale = profile?.locale ?? 'it';
  const myId = session?.user.id;

  const [draft, setDraft] = useState('');
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const listRef = useRef<RNFlatList<PostComment>>(null);

  const flashToast = (msg: string) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2500);
    setToast(msg);
  };
  // Clear a pending toast timer on unmount so it can't setToast on a dead component.
  useEffect(
    () => () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
    },
    [],
  );

  const postQuery = useQuery({
    queryKey: postKeys.detail(id),
    queryFn: () => getPostById(supabase, id),
    enabled: Boolean(id),
  });
  const post = postQuery.data;
  const isAuthor = Boolean(post && myId === post.author_id);

  const reactionQuery = useQuery({
    queryKey: [...postKeys.reactions(id), 'viewer'],
    queryFn: () => getViewerReaction(supabase, id),
    enabled: Boolean(id) && !isAuthor,
  });
  const countQuery = useQuery({
    queryKey: [...postKeys.reactions(id), 'count'],
    queryFn: () => getAuthorReactionCount(supabase, id),
    enabled: Boolean(id) && isAuthor,
  });

  const commentsQuery = useInfiniteQuery({
    queryKey: postKeys.comments(id),
    queryFn: ({ pageParam }) =>
      getCommentsPage(supabase, { postId: id, cursor: pageParam as CommentCursor | null }),
    initialPageParam: null as CommentCursor | null,
    getNextPageParam: (last) => last.nextCursor,
    enabled: Boolean(id),
  });
  const comments = commentsQuery.data?.pages.flatMap((p) => p.comments) ?? [];
  // `staleWins`: replies already on screen stay through a lost refresh — realtime invalidates
  // this key on every insert, so a flaky connection would otherwise blank the thread repeatedly.
  const commentsState = listState({
    status: commentsQuery.status,
    fetchStatus: commentsQuery.fetchStatus,
    isEmpty: comments.length === 0,
    staleWins: true,
  });

  useEffect(() => {
    if (!id) return;
    const unsubscribe = subscribeComments(supabase, id, () => {
      void queryClient.invalidateQueries({ queryKey: postKeys.comments(id) });
    });
    return unsubscribe;
  }, [id, queryClient]);

  const toggleReaction = useMutation({
    mutationFn: () => togglePostReaction(supabase, id, myId as string),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: [...postKeys.reactions(id), 'viewer'] }),
  });

  // #101: optimistic insert. The row appears (dimmed) at the top of the replies the moment
  // the ✦ is tapped, and the list scrolls to it — no blocking alert, no invisible landing.
  // The client uuid doubles as the insert's PK, so the queryClient's `retry: 1` on a lost
  // response conflicts on the key instead of double-posting.
  const sendComment = useMutation({
    mutationFn: (vars: { id: string; body: string }) =>
      addComment(supabase, {
        id: vars.id,
        post_id: id,
        author_id: myId as string,
        body: vars.body,
        parent_id: null,
      }),
    onMutate: async (vars) => {
      await queryClient.cancelQueries({ queryKey: postKeys.comments(id) });
      const previous = queryClient.getQueryData<InfiniteData<CommentPage>>(postKeys.comments(id));
      const now = new Date().toISOString();
      queryClient.setQueryData<InfiniteData<CommentPage>>(postKeys.comments(id), (data) =>
        prependComment(data, {
          id: vars.id,
          post_id: id,
          author_id: myId as string,
          parent_id: null,
          body: vars.body,
          created_at: now,
          updated_at: now,
          deleted_at: null,
        }),
      );
      const draftBackup = draft;
      setDraft('');
      // After the re-render lands, bring the new row (index 0, behind the post header) into view.
      requestAnimationFrame(() =>
        listRef.current?.scrollToIndex({ index: 0, animated: true, viewPosition: 0 }),
      );
      return { previous, draftBackup };
    },
    // Same uuid server-side, so the refetched row replaces the optimistic one under its own key.
    onSuccess: () => queryClient.invalidateQueries({ queryKey: postKeys.comments(id) }),
    onError: (_err, _vars, ctx) => {
      if (ctx?.previous) queryClient.setQueryData(postKeys.comments(id), ctx.previous);
      // Refetch truth either way: it clears the optimistic row when nothing was cached, and
      // surfaces the committed row when the "failure" was a retry hitting its own PK.
      void queryClient.invalidateQueries({ queryKey: postKeys.comments(id) });
      // Give the text back unless the member already started a new draft.
      if (ctx) setDraft((cur) => (cur.length > 0 ? cur : ctx.draftBackup));
      flashToast(t('comment.send.error', locale));
    },
  });

  const deleteComment = useMutation({
    mutationFn: (commentId: string) => softDeleteComment(supabase, commentId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: postKeys.comments(id) });
    },
  });

  const del = useMutation({
    mutationFn: () => softDeletePost(supabase, id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: postKeys.all });
      router.back();
    },
  });
  const confirmDelete = () => {
    Alert.alert(t('post.delete.confirm', locale), undefined, [
      { text: t('common.cancel', locale), style: 'cancel' },
      { text: t('post.delete', locale), style: 'destructive', onPress: () => del.mutate() },
    ]);
  };

  if (postQuery.isLoading) {
    return (
      <Screen className="items-center justify-center">
        <Text className="text-2xl text-faint">✦</Text>
      </Screen>
    );
  }
  if (!post) {
    return (
      <Screen className="items-center justify-center px-5">
        <Text className="text-[15px] text-foreground">{t('feed.error', locale)}</Text>
      </Screen>
    );
  }

  const categoryLabel = t(`feed.filter.${post.category}` as MessageKey, locale);

  return (
    <KeyboardAvoiding>
      <Screen>
        <ModalHeader
          title={categoryLabel}
          backLabel={t('common.back', locale)}
          right={
            isAuthor ? (
              <Pressable onPress={confirmDelete} accessibilityRole="button" hitSlop={8}>
                <Text className="text-[13px] text-error">{t('post.delete', locale)}</Text>
              </Pressable>
            ) : (
              <Pressable
                onPress={() =>
                  router.push({
                    pathname: '/(modal)/report',
                    params: { targetType: 'post', targetId: post.id },
                  })
                }
                accessibilityRole="button"
                accessibilityLabel={t('report.title', locale)}
                hitSlop={8}
              >
                <Text className="text-[13px] text-faint">{t('report.title', locale)}</Text>
              </Pressable>
            )
          }
        />
        <FlatList
          ref={listRef}
          data={comments}
          keyExtractor={(item) => item.id}
          contentContainerClassName="gap-3 px-5 pb-4 pt-2"
          // Index 0 sits below the (possibly unmeasured) post header; fall back to the top.
          onScrollToIndexFailed={() =>
            listRef.current?.scrollToOffset({ offset: 0, animated: true })
          }
          ListHeaderComponent={
            <View className="gap-5 pb-3">
              <PostAuthorRow authorId={post.author_id} />

              {post.is_step ? (
                <Text className="text-[12px] text-aura">✦ {t('feed.flag.step', locale)}</Text>
              ) : null}
              <Text className="text-[16px] leading-7 text-foreground">{post.body}</Text>
              <PostMedia postId={post.id} postType={post.type} variant="detail" locale={locale} />

              <View className="flex-row items-center gap-2 border-t border-hair pt-4">
                {isAuthor ? (
                  <Text className="text-[13px] text-muted-foreground">
                    ✦ {t('post.author.reactions', locale, { n: countQuery.data ?? 0 })}
                  </Text>
                ) : (
                  <ReactionStar
                    lit={Boolean(reactionQuery.data)}
                    pending={toggleReaction.isPending}
                    onPress={() => toggleReaction.mutate()}
                    locale={locale}
                  />
                )}
              </View>

              <Text className="pt-2 text-[14px] font-semibold text-foreground">
                {t('comment.sectionLabel', locale)}
              </Text>
            </View>
          }
          renderItem={({ item }) => {
            const isOptimistic = sendComment.isPending && sendComment.variables?.id === item.id;
            return (
              <Comment
                comment={item}
                locale={locale}
                pending={isOptimistic}
                onDelete={
                  // No delete while in flight: the row's uuid isn't on the server yet, so the
                  // soft-delete would match nothing and the row would "survive" its own deletion.
                  item.author_id === myId && !isOptimistic
                    ? () =>
                        Alert.alert(t('comment.delete.confirm', locale), undefined, [
                          { text: t('common.cancel', locale), style: 'cancel' },
                          {
                            text: t('comment.delete', locale),
                            style: 'destructive',
                            onPress: () => deleteComment.mutate(item.id),
                          },
                        ])
                    : undefined
                }
              />
            );
          }}
          ListEmptyComponent={
            // ONE answer about the replies, not two. `comment.error` used to be a bare line in the
            // header with no way out, while this slot separately claimed «Nessun commento» off
            // `!isLoading` — so a failed read said both at once, a retry above a contradiction
            // (#111). The header block is gone; this is the whole decision.
            <ListState
              state={commentsState}
              locale={locale}
              errorLabel={t('comment.error', locale)}
              emptyLabel={t('comment.empty', locale)}
              onRetry={() => void commentsQuery.refetch()}
              className="px-1 py-2"
              loading={null}
            />
          }
          onEndReachedThreshold={0.5}
          onEndReached={() => {
            if (commentsQuery.hasNextPage && !commentsQuery.isFetchingNextPage)
              void commentsQuery.fetchNextPage();
          }}
        />

        <View className="flex-row items-center gap-2 border-t border-hair bg-background px-5 py-3">
          <TextInput
            className="flex-1 rounded-full border border-hair bg-raise px-4 py-2 text-[14px] text-foreground"
            placeholder={t('comment.placeholder', locale)}
            placeholderTextColor={semantic.faint}
            value={draft}
            onChangeText={setDraft}
            multiline
          />
          {/* P2.5 hint-truth: no comment-hint — the engine never rewards commenting (anti-gaming). */}
          <Pressable
            disabled={draft.trim().length === 0 || sendComment.isPending}
            onPress={() => sendComment.mutate({ id: Crypto.randomUUID(), body: draft.trim() })}
            className="min-h-[44px] items-center justify-center rounded-ctl bg-aura px-4"
          >
            <Text className="text-[20px] text-background">✦</Text>
          </Pressable>
        </View>

        {/* Inline toast — no global host; same recipe as settings/blocked/data-export. */}
        {toast ? <Toast label={toast} /> : null}
      </Screen>
    </KeyboardAvoiding>
  );
}
