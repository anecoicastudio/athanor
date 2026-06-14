import { useEffect, useState } from 'react';
import { Alert, FlatList, KeyboardAvoidingView, Platform } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  addComment,
  type CommentCursor,
  getAuthorReactionCount,
  getCommentsPage,
  getPostById,
  getViewerReaction,
  postKeys,
  softDeletePost,
  subscribeComments,
  togglePostReaction,
} from '@athanor/api';
import { AURA_WEIGHTS } from '@athanor/core';
import { semantic } from '@athanor/config';
import { type MessageKey, t } from '@athanor/i18n';
import { Pressable, Text, TextInput, View } from '@/tw';
import { Comment } from '@/components/feed/Comment';
import { PostAuthorRow } from '@/components/feed/PostAuthorRow';
import { ReactionStar } from '@/components/feed/ReactionStar';
import { useAuth } from '@/lib/auth-context';
import { supabase } from '@/lib/supabase';

export default function PostDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { profile, session } = useAuth();
  const router = useRouter();
  const queryClient = useQueryClient();
  const locale = profile?.locale ?? 'it';
  const myId = session?.user.id;

  const [draft, setDraft] = useState('');

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

  const sendComment = useMutation({
    mutationFn: (body: string) =>
      addComment(supabase, { post_id: id, author_id: myId as string, body, parent_id: null }),
    onSuccess: async () => {
      setDraft('');
      await queryClient.invalidateQueries({ queryKey: postKeys.comments(id) });
      Alert.alert(t('comment.toast.posted', locale));
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
      <View className="flex-1 items-center justify-center bg-background">
        <Text className="text-2xl text-faint">✦</Text>
      </View>
    );
  }
  if (!post) {
    return (
      <View className="flex-1 items-center justify-center bg-background px-5">
        <Text className="text-[15px] text-faint">{t('feed.error', locale)}</Text>
      </View>
    );
  }

  const categoryLabel = t(`feed.filter.${post.category}` as MessageKey, locale);

  return (
    <KeyboardAvoidingView
      className="flex-1 bg-background"
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <FlatList
        data={comments}
        keyExtractor={(item) => item.id}
        contentContainerClassName="gap-3 px-5 py-8 pb-4"
        ListHeaderComponent={
          <View className="gap-5 pb-3">
            <View className="flex-row items-center justify-between">
              <Text className="text-[12px] uppercase tracking-wider text-faint">
                {categoryLabel}
              </Text>
              {isAuthor ? (
                <Pressable onPress={confirmDelete}>
                  <Text className="text-[13px] text-error">{t('post.delete', locale)}</Text>
                </Pressable>
              ) : null}
            </View>

            <PostAuthorRow authorId={post.author_id} />

            {post.is_step ? (
              <Text className="text-[12px] text-aura">✦ {t('feed.flag.step', locale)}</Text>
            ) : null}
            <Text className="text-[16px] leading-7 text-foreground">{post.body}</Text>

            <View className="flex-row items-center gap-2 border-t border-hair pt-4">
              {isAuthor ? (
                <Text className="text-[13px] text-faint">
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
            {commentsQuery.isError ? (
              <Text className="text-[13px] text-faint">{t('comment.error', locale)}</Text>
            ) : null}
          </View>
        }
        renderItem={({ item }) => <Comment comment={item} locale={locale} />}
        ListEmptyComponent={
          !commentsQuery.isLoading ? (
            <Text className="px-1 text-[14px] text-faint">{t('comment.empty', locale)}</Text>
          ) : null
        }
        onEndReachedThreshold={0.5}
        onEndReached={() => {
          if (commentsQuery.hasNextPage && !commentsQuery.isFetchingNextPage)
            void commentsQuery.fetchNextPage();
        }}
      />

      <View className="flex-row items-center gap-2 border-t border-hair bg-background px-5 py-3">
        <TextInput
          className="flex-1 rounded-ctl border border-hair bg-raise px-4 py-2 text-[14px] text-foreground"
          placeholder={t('comment.placeholder', locale)}
          placeholderTextColor={semantic.faint}
          value={draft}
          onChangeText={setDraft}
          multiline
        />
        <Text className="text-[11px] text-aura">
          {t('post.compose.auraHint', locale, { n: AURA_WEIGHTS.COMMENT_CREATE })}
        </Text>
        <Pressable
          disabled={draft.trim().length === 0 || sendComment.isPending}
          onPress={() => sendComment.mutate(draft.trim())}
          className="min-h-[44px] items-center justify-center rounded-ctl bg-aura px-4"
        >
          <Text className="text-[20px] text-background">✦</Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}
