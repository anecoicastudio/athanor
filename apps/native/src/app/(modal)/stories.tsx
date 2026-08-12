import { Alert } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getAuthorStoryCount,
  getOrCreateConversation,
  getPersonStory,
  getViewerStoryReaction,
  pinStoryStep,
  softDeleteStorySegment,
  storyKeys,
  toggleStoryReaction,
} from '@athanor/api';
import { t } from '@athanor/i18n';
import { StoriesViewer } from '@/components/stories/StoriesViewer';
import { useSignedUrls } from '@/lib/media/use-signed-urls';
import { useAuth } from '@/lib/auth-context';
import { supabase } from '@/lib/supabase';
import { Text, View } from '@/tw';

export default function StoriesScreen() {
  const { authorId, handle } = useLocalSearchParams<{ authorId: string; handle?: string }>();
  const { profile, session } = useAuth();
  const router = useRouter();
  const queryClient = useQueryClient();
  const locale = profile?.locale ?? 'it';
  const myId = session?.user.id;
  const targetId = authorId === 'me' ? (myId ?? '') : authorId;
  const isOwn = targetId === myId;

  const personQuery = useQuery({
    queryKey: storyKeys.person(targetId),
    queryFn: () => getPersonStory(supabase, targetId),
    enabled: Boolean(targetId),
  });
  const segments = personQuery.data?.segments ?? [];
  const [first] = segments;
  // The viewer owns its own segment index; the host only needs the first for reaction gating.
  const current = segments[0];

  const { urls, isLoading: urlsLoading } = useSignedUrls(
    'story-segments',
    segments.map((s) => s.storage_path),
  );

  const name = isOwn ? t('story.viewer.youName', locale) : (handle ?? '—');

  const reactionQuery = useQuery({
    queryKey: [...storyKeys.reactions(current?.id ?? 'none'), 'viewer'],
    queryFn: () => getViewerStoryReaction(supabase, current!.id, myId),
    enabled: Boolean(current) && !isOwn && Boolean(myId),
  });
  const countQuery = useQuery({
    queryKey: [...storyKeys.reactions(current?.id ?? 'none'), 'count'],
    queryFn: () => getAuthorStoryCount(supabase, current!.id),
    enabled: Boolean(current) && isOwn,
  });

  if (personQuery.isLoading) {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <Text className="text-2xl text-faint">✦</Text>
      </View>
    );
  }
  if (segments.length === 0 || !first) {
    return (
      <View className="flex-1 items-center justify-center bg-background px-6">
        <Text className="text-center text-[15px] text-faint">{t('story.expired', locale)}</Text>
      </View>
    );
  }

  return (
    <StoriesViewer
      segments={segments}
      urls={urls}
      urlsLoading={urlsLoading}
      name={name}
      isOwn={isOwn}
      viewerReacted={Boolean(reactionQuery.data)}
      count={countQuery.data ?? 0}
      locale={locale}
      onClose={() => router.back()}
      onAdvanceEnd={() => router.back()}
      onReact={async (seg) => {
        if (!myId) return;
        await toggleStoryReaction(supabase, seg.id, myId);
        await queryClient.invalidateQueries({
          queryKey: [...storyKeys.reactions(seg.id), 'viewer'],
        });
        Alert.alert(t('story.react.toast', locale));
      }}
      onReply={async () => {
        // Reply = open the DM with the author (P3.5, canonical open-or-create pattern).
        if (!myId || isOwn || !targetId) return;
        try {
          const conversationId = await getOrCreateConversation(supabase, targetId);
          router.push(`/chat?conversationId=${conversationId}`);
        } catch {
          Alert.alert(t('chat.openFailed', locale));
        }
      }}
      onMakeDream={() => {
        // Same sheet the dream card opens (PRD §132) — pick a tappa, then offer. Ungated:
        // prefetching a dream per story view is not worth it, and a target with no dream
        // lands on the picker's honest empty state rather than a toast (issue #109).
        if (isOwn || !targetId) return;
        router.push({ pathname: '/(modal)/help', params: { userId: targetId } });
      }}
      onAddMoment={() => {
        router.back();
        router.push('/(tabs)/profile');
      }}
      onPin={async (seg) => {
        await pinStoryStep(supabase, seg.id);
        await queryClient.invalidateQueries({ queryKey: storyKeys.person(targetId) });
      }}
      onDelete={(seg) => {
        Alert.alert(t('story.own.delete.confirm', locale), undefined, [
          { text: t('common.cancel', locale), style: 'cancel' },
          {
            text: t('story.own.delete', locale),
            style: 'destructive',
            onPress: () => {
              void (async () => {
                try {
                  await softDeleteStorySegment(supabase, seg.id);
                  await queryClient.invalidateQueries({ queryKey: storyKeys.person(targetId) });
                  router.back();
                } catch {
                  Alert.alert(t('story.own.delete.error', locale));
                }
              })();
            },
          },
        ]);
      }}
    />
  );
}
