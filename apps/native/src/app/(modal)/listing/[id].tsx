import { useState } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { getOrCreateConversation, getProject, projectKeys } from '@athanor/api';
import { type MessageKey, t } from '@athanor/i18n';
import { Pressable, ScrollView, Text, View } from '@/tw';
import { Button } from '@/components/Button';
import { ListState } from '@/components/ListState';
import { ModalHeader } from '@/components/ModalHeader';
import { PostAuthorRow } from '@/components/feed/PostAuthorRow';
import { useAuth } from '@/lib/auth-context';
import { listState } from '@/lib/list-state';
import { supabase } from '@/lib/supabase';

export default function ProjectDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { session, profile } = useAuth();
  const router = useRouter();
  const locale = profile?.locale ?? 'it';
  const [opening, setOpening] = useState(false);
  const [openFailed, setOpenFailed] = useState(false);

  const query = useQuery({
    queryKey: projectKeys.detail(id),
    queryFn: () => getProject(supabase, id),
    enabled: !!id,
  });

  const project = query.data;
  // The board does not filter your own projects out, so «Rispondi» has to: the RPC raises
  // `cannot open a conversation with oneself`, and that would surface as `chat.openFailed`
  // — an error message for something that is not an error.
  const isOwn = Boolean(session && project && project.author_id === session.user.id);

  // «Rispondi» — open-or-create the DM with whoever posted the project (P3.3), the same
  // open-or-create path as the favor sheet, person detail and the story reply.
  const respond = async () => {
    if (!project || opening) return;
    setOpening(true);
    setOpenFailed(false);
    try {
      const conversationId = await getOrCreateConversation(supabase, project.author_id);
      router.push(`/chat?conversationId=${conversationId}`);
    } catch {
      setOpenFailed(true);
    } finally {
      setOpening(false);
    }
  };

  // `staleWins`: a project page a few minutes old is still that project.
  const detailState = listState({
    status: query.status,
    fetchStatus: query.fetchStatus,
    isEmpty: project == null,
    staleWins: true,
  });

  return (
    <View className="flex-1 bg-background">
      <ModalHeader title={t('project.detail.title', locale)} backLabel={t('common.back', locale)} />
      <ScrollView className="flex-1" contentContainerClassName="gap-5 px-5 pb-8">
        {/* One branch used to cover a failed read AND a project that no longer exists, with no
            way out of either — «Non siamo riusciti a caricare la bacheca» on a dead deep link,
            and no retry on a real failure (#111). */}
        <ListState
          state={detailState}
          locale={locale}
          errorLabel={t('project.error', locale)}
          emptyLabel={t('project.notFound', locale)}
          onRetry={() => void query.refetch()}
          className="pt-16"
          loading={null}
        />

        {project ? (
          <>
            <View className="flex-row items-start justify-between gap-3">
              <Text className="flex-1 text-2xl text-foreground">{project.title}</Text>
              <View className="rounded-full border border-hair bg-raise px-3 py-1">
                <Text className="text-[12px] text-faint">
                  {t(`costellazioni.filter.${project.category}` as MessageKey, locale)}
                </Text>
              </View>
            </View>

            {project.description ? (
              <Text className="text-[15px] leading-6 text-foreground">{project.description}</Text>
            ) : null}

            <View className="gap-3 rounded-card border border-hair bg-raise p-5">
              <PostAuthorRow authorId={project.author_id} />
              <Pressable
                onPress={() => router.push(`/(modal)/user/${project.author_id}`)}
                hitSlop={8}
              >
                <Text className="text-[13px] text-aura">
                  {t('project.detail.viewProfile', locale)}
                </Text>
              </Pressable>
            </View>

            {isOwn ? null : (
              <>
                {openFailed ? (
                  <Text className="text-[13px] text-error">{t('chat.openFailed', locale)}</Text>
                ) : null}
                <Button
                  label={t('project.respond', locale)}
                  onPress={() => void respond()}
                  variant="light"
                  disabled={opening}
                />
              </>
            )}
          </>
        ) : null}
      </ScrollView>
    </View>
  );
}
