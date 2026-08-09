import { useState } from 'react';
import { KeyboardAvoidingView, Platform } from 'react-native';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createProject, projectKeys } from '@athanor/api';
import { semantic } from '@athanor/config';
import { type MessageKey, t } from '@athanor/i18n';
import type { ProjectCategory } from '@athanor/schemas';
import { Pressable, ScrollView, Text, TextInput, View } from '@/tw';
import { Button } from '@/components/Button';
import { ModalHeader } from '@/components/ModalHeader';
import { SectionLabel } from '@/components/SectionLabel';
import { useAuth } from '@/lib/auth-context';
import { supabase } from '@/lib/supabase';

const CATEGORIES: ProjectCategory[] = [
  'startup',
  'artistic',
  'business',
  'scientific',
  'volunteer',
];

export default function ProjectComposeScreen() {
  const { profile, session } = useAuth();
  const router = useRouter();
  const queryClient = useQueryClient();
  const locale = profile?.locale ?? 'it';
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState<ProjectCategory>('startup');
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);

  const authorId = session?.user.id;

  const mutation = useMutation({
    mutationFn: async () => {
      if (!authorId) throw new Error('no session');
      return createProject(supabase, {
        author_id: authorId,
        title,
        category,
        description,
        terms: null,
      });
    },
    onSuccess: async () => {
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      await queryClient.invalidateQueries({ queryKey: projectKeys.all });
      router.back();
    },
    onError: () => setError(t('project.compose.error', locale)),
  });

  const onPublish = () => {
    if (title.trim().length === 0) {
      setError(t('project.compose.error', locale));
      return;
    }
    setError(null);
    mutation.mutate();
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View className="flex-1 bg-background">
        <ModalHeader
          title={t('create.project.title', locale)}
          backLabel={t('common.back', locale)}
        />
        <ScrollView className="flex-1" contentContainerClassName="gap-5 px-5 pb-8">
          <Text className="text-[14px] text-faint">{t('create.project.desc', locale)}</Text>

          <View className="gap-2">
            <SectionLabel>{t('project.compose.titleLabel', locale)}</SectionLabel>
            <TextInput
              className="rounded-full border border-hair bg-raise p-4 text-[15px] text-foreground"
              placeholder={t('project.compose.titlePlaceholder', locale)}
              placeholderTextColor={semantic.foregroundMuted}
              value={title}
              onChangeText={setTitle}
              maxLength={140}
            />
          </View>
          {error ? <Text className="text-[13px] text-error">{error}</Text> : null}

          <View className="gap-2">
            <SectionLabel>{t('project.compose.catLabel', locale)}</SectionLabel>
            <View className="flex-row flex-wrap gap-2">
              {CATEGORIES.map((c) => {
                const isActive = c === category;
                return (
                  <Pressable
                    key={c}
                    onPress={() => setCategory(c)}
                    className={`rounded-full border px-4 py-2 ${
                      isActive ? 'border-aura-line bg-aura-soft' : 'border-hair bg-raise'
                    }`}
                  >
                    <Text className={`text-[13px] ${isActive ? 'text-aura' : 'text-faint'}`}>
                      {t(`costellazioni.filter.${c}` as MessageKey, locale)}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          <View className="gap-2">
            <SectionLabel>{t('project.compose.descLabel', locale)}</SectionLabel>
            <TextInput
              className="min-h-[120px] rounded-hero border border-hair bg-raise p-4 text-[15px] text-foreground"
              placeholder={t('project.compose.descPlaceholder', locale)}
              placeholderTextColor={semantic.foregroundMuted}
              value={description}
              onChangeText={setDescription}
              multiline
              textAlignVertical="top"
            />
          </View>

          {/* P2.5 hint-truth: no create-hint — the engine never rewards publishing (anti-gaming). */}
          <Button
            label={t('common.publish', locale)}
            onPress={onPublish}
            disabled={mutation.isPending}
            variant="light"
          />
        </ScrollView>
      </View>
    </KeyboardAvoidingView>
  );
}
