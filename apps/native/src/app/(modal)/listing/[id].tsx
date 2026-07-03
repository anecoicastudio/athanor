import { useState } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { getProject, projectKeys } from '@athanor/api';
import { type MessageKey, t } from '@athanor/i18n';
import { Pressable, ScrollView, Text, View } from '@/tw';
import { Button } from '@/components/Button';
import { EmptyState } from '@/components/EmptyState';
import { PostAuthorRow } from '@/components/feed/PostAuthorRow';
import { useAuth } from '@/lib/auth-context';
import { supabase } from '@/lib/supabase';

export default function ProjectDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { profile } = useAuth();
  const router = useRouter();
  const locale = profile?.locale ?? 'it';
  const [toast, setToast] = useState<string | null>(null);

  const query = useQuery({
    queryKey: projectKeys.detail(id),
    queryFn: () => getProject(supabase, id),
    enabled: !!id,
  });

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2500);
  };

  const project = query.data;

  return (
    <ScrollView className="flex-1 bg-background" contentContainerClassName="gap-5 px-5 py-8">
      <View className="flex-row items-center gap-3">
        <Pressable onPress={() => router.back()} hitSlop={8}>
          <Text className="text-[15px] text-faint">‹ {t('common.back', locale)}</Text>
        </Pressable>
        <Text className="text-[11px] font-semibold uppercase tracking-[0.16em] text-faint">
          {t('project.detail.title', locale)}
        </Text>
      </View>

      {query.isError || (!query.isLoading && !project) ? (
        <View className="pt-16">
          <EmptyState>{t('costellazioni.error', locale)}</EmptyState>
        </View>
      ) : null}

      {project ? (
        <>
          <View className="flex-row items-start justify-between gap-3">
            <Text className="flex-1 text-2xl text-foreground">{project.title}</Text>
            <View className="rounded-ctl border border-hair bg-raise px-3 py-1">
              <Text className="text-[12px] text-faint">
                {t(`costellazioni.filter.${project.category}` as MessageKey, locale)}
              </Text>
            </View>
          </View>

          {project.description ? (
            <Text className="text-[15px] leading-6 text-foreground">{project.description}</Text>
          ) : null}

          <View className="gap-3 rounded-card border border-hair bg-raise p-4">
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

          <Button
            label={t('project.respond', locale)}
            onPress={() => showToast(t('project.respond.soon', locale))}
            variant="light"
          />
        </>
      ) : null}

      {toast ? (
        <View className="rounded-ctl bg-aura-soft px-4 py-3">
          <Text className="text-center text-[13px] text-aura">{toast}</Text>
        </View>
      ) : null}
    </ScrollView>
  );
}
