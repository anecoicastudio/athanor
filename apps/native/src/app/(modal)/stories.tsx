import { useState } from 'react';
import { Alert } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { buildStorySession } from '@athanor/core';
import {
  getAuthorStoryCount,
  getOrCreateConversation,
  getPersonStory,
  getViewerStoryReaction,
  pinStoryStep,
  sendMessage,
  softDeleteStorySegment,
  type StoryRailPerson,
  storyKeys,
  toggleStoryReaction,
} from '@athanor/api';
import type { StorySegment } from '@athanor/schemas';
import { t } from '@athanor/i18n';
import { StoriesViewer } from '@/components/stories/StoriesViewer';
import { useSignedUrls } from '@/lib/media/use-signed-urls';
import { useAuth } from '@/lib/auth-context';
import { useStorySeen } from '@/hooks/use-story-seen';
import { supabase } from '@/lib/supabase';
import { Text } from '@/tw';
import { Screen } from '@/components/Screen';

export default function StoriesScreen() {
  const { authorId, handle } = useLocalSearchParams<{ authorId: string; handle?: string }>();
  const { profile, session } = useAuth();
  const router = useRouter();
  const queryClient = useQueryClient();
  const locale = profile?.locale ?? 'it';
  const myId = session?.user.id;
  const targetId = authorId === 'me' ? (myId ?? '') : authorId;
  const { seenIds, markSeen } = useStorySeen();

  // The session (#298): the route carries only the entry person; the ordered author list is
  // derived once, from the rail already warm in the cache (community just rendered it), via the
  // pure @athanor/core ordering. It is deliberately NOT rebuilt when seen state or the rail
  // change mid-session — the chain the member entered stays stable.
  const [session298] = useState<string[]>(() => {
    const rail = queryClient.getQueryData<StoryRailPerson[]>(storyKeys.rail()) ?? [];
    const myStory = myId
      ? queryClient.getQueryData<{ segments: StorySegment[] }>(storyKeys.person(myId))
      : undefined;
    const myHasLive = (myStory?.segments ?? []).some(
      (s) => !s.deleted_at && new Date(s.expires_at).getTime() > Date.now(),
    );
    const candidates = [
      // Your own story is part of the chain (#298 decision 3); the rail itself never lists you.
      ...(myId && myHasLive ? [{ author_id: myId }] : []),
      ...rail.map((p) => ({ author_id: p.author_id })),
    ];
    const ordered = buildStorySession(candidates, targetId, seenIds).map((p) => p.author_id);
    // A cold deep link (empty rail cache) or an entry the rail lost still plays the tapped person.
    return ordered.includes(targetId) ? ordered : [targetId, ...ordered];
  });
  const [ai, setAi] = useState(0);
  const [startAt, setStartAt] = useState<'first' | 'last'>('first');
  const currentAuthorId = session298[ai] ?? targetId;
  const isOwn = currentAuthorId === myId;

  const personQuery = useQuery({
    queryKey: storyKeys.person(currentAuthorId),
    queryFn: () => getPersonStory(supabase, currentAuthorId),
    enabled: Boolean(currentAuthorId),
  });
  const segments = personQuery.data?.segments ?? [];
  const [first] = segments;
  // The viewer owns its own segment index; the host only needs the first for reaction gating.
  const current = segments[0];

  const { urls, isLoading: urlsLoading } = useSignedUrls(
    'story-segments',
    segments.map((s) => s.storage_path),
  );

  // Prefetch the next person while the current one plays (#298): their segments and the signed
  // URL of their first segment, so the handoff is not a blank frame.
  const nextAuthorId = session298[ai + 1];
  const nextQuery = useQuery({
    queryKey: storyKeys.person(nextAuthorId ?? ''),
    queryFn: () => getPersonStory(supabase, nextAuthorId as string),
    enabled: Boolean(nextAuthorId),
  });
  useSignedUrls(
    'story-segments',
    (nextQuery.data?.segments ?? []).slice(0, 1).map((s) => s.storage_path),
  );

  const goToNextPerson = (finished: boolean) => {
    // Seen means FINISHED (#298) — a horizontal skip does not burn the ring.
    if (finished && currentAuthorId) markSeen(currentAuthorId);
    if (ai + 1 < session298.length) {
      setStartAt('first');
      setAi(ai + 1);
    } else {
      router.back(); // the session ends after the last person
    }
  };
  const goToPrevPerson = () => {
    if (ai > 0) {
      setStartAt('last'); // tap-left on a first segment lands on the previous person's LAST
      setAi(ai - 1);
    }
  };

  const railPerson = queryClient
    .getQueryData<StoryRailPerson[]>(storyKeys.rail())
    ?.find((p) => p.author_id === currentAuthorId);
  const name = isOwn
    ? t('story.viewer.youName', locale)
    : (railPerson?.handle ?? (currentAuthorId === targetId ? (handle ?? '—') : '—'));

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
      <Screen className="items-center justify-center">
        <Text className="text-2xl text-faint">✦</Text>
      </Screen>
    );
  }
  if (segments.length === 0 || !first) {
    return (
      <Screen className="items-center justify-center px-6">
        <Text className="text-center text-[15px] text-faint">{t('story.expired', locale)}</Text>
      </Screen>
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
      onAdvanceEnd={() => goToNextPerson(true)}
      onAdvanceStart={goToPrevPerson}
      onJumpNext={() => goToNextPerson(false)}
      onJumpPrev={goToPrevPerson}
      startAt={startAt}
      onReact={async (seg) => {
        if (!myId) return;
        await toggleStoryReaction(supabase, seg.id, myId);
        await queryClient.invalidateQueries({
          queryKey: [...storyKeys.reactions(seg.id), 'viewer'],
        });
        Alert.alert(t('story.react.toast', locale));
      }}
      onSendReply={async (body) => {
        // Reply sends into the DM in the background (#297) — the viewer is never left.
        // Open-or-create is the canonical P3.5 pattern; the viewer owns the confirmation toast.
        if (!myId || isOwn || !currentAuthorId) throw new Error('cannot reply');
        const conversationId = await getOrCreateConversation(supabase, currentAuthorId);
        await sendMessage(supabase, { conversationId, senderId: myId, body });
      }}
      onMakeDream={() => {
        // Same sheet the dream card opens (PRD §132) — pick a tappa, then offer. Ungated:
        // prefetching a dream per story view is not worth it, and a target with no dream
        // lands on the picker's honest empty state rather than a toast (issue #109).
        if (isOwn || !currentAuthorId) return;
        router.push({ pathname: '/(modal)/help', params: { userId: currentAuthorId } });
      }}
      onAddMoment={() => {
        // The story composer (#317) — this used to misroute to the profile Momenti gallery.
        router.back();
        router.push('/(modal)/story-compose');
      }}
      onPin={async (seg) => {
        await pinStoryStep(supabase, seg.id);
        await queryClient.invalidateQueries({ queryKey: storyKeys.person(currentAuthorId) });
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
                  await queryClient.invalidateQueries({
                    queryKey: storyKeys.person(currentAuthorId),
                  });
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
