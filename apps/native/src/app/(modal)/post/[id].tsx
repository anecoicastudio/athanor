import { Alert } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getPostById, postKeys, softDeletePost } from '@athanor/api';
import { type MessageKey, t } from '@athanor/i18n';
import { Pressable, ScrollView, Text, View } from '@/tw';
import { useAuth } from '@/lib/auth-context';
import { supabase } from '@/lib/supabase';

export default function PostDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { profile, session } = useAuth();
  const router = useRouter();
  const queryClient = useQueryClient();
  const locale = profile?.locale ?? 'it';

  const query = useQuery({
    queryKey: postKeys.detail(id),
    queryFn: () => getPostById(supabase, id),
    enabled: Boolean(id),
  });

  const post = query.data;
  const isAuthor = Boolean(post && session?.user.id === post.author_id);

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

  if (query.isLoading) {
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
    <ScrollView className="flex-1 bg-background" contentContainerClassName="gap-5 px-5 py-8">
      <View className="flex-row items-center justify-between">
        <Text className="text-[12px] uppercase tracking-wider text-faint">{categoryLabel}</Text>
        {isAuthor ? (
          <Pressable onPress={confirmDelete}>
            <Text className="text-[13px] text-error">{t('post.delete', locale)}</Text>
          </Pressable>
        ) : null}
      </View>

      {post.is_step ? (
        <Text className="text-[12px] text-aura">✦ {t('feed.flag.step', locale)}</Text>
      ) : null}
      <Text className="text-[16px] leading-7 text-foreground">{post.body}</Text>

      {/* Comments/reactions = reactions-comments slice. Honest placeholder for now. */}
      <View className="rounded-card border border-hair bg-raise p-5">
        <Text className="text-[14px] text-faint">{t('post.comingSoon', locale)}</Text>
      </View>
    </ScrollView>
  );
}
