import { useState } from 'react';
import { KeyboardAvoidingView, Platform } from 'react-native';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createProject, projectKeys } from '@athanor/api';
import { semantic } from '@athanor/config';
import { AURA_WEIGHTS } from '@athanor/core';
import { type MessageKey, t } from '@athanor/i18n';
import type { ProjectCategory } from '@athanor/schemas';
import { Pressable, ScrollView, Text, TextInput, View } from '@/tw';
import { Button } from '@/components/Button';
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
      <ScrollView className="flex-1 bg-background" contentContainerClassName="gap-5 px-5 py-8">
        <View className="gap-1">
          <Text className="text-2xl text-foreground">{t('create.project.title', locale)}</Text>
          <Text className="text-[14px] text-faint">{t('create.project.desc', locale)}</Text>
        </View>

        <View className="gap-2">
          <Text className="text-[12px] uppercase tracking-wider text-faint">
            {t('project.compose.titleLabel', locale)}
          </Text>
          <TextInput
            className="rounded-card border border-hair bg-raise p-4 text-[15px] text-foreground"
            placeholder={t('project.compose.titlePlaceholder', locale)}
            placeholderTextColor={semantic.foregroundMuted}
            value={title}
            onChangeText={setTitle}
          />
        </View>
        {error ? <Text className="text-[13px] text-error">{error}</Text> : null}

        <View className="gap-2">
          <Text className="text-[12px] uppercase tracking-wider text-faint">
            {t('project.compose.catLabel', locale)}
          </Text>
          <View className="flex-row flex-wrap gap-2">
            {CATEGORIES.map((c) => {
              const isActive = c === category;
              return (
                <Pressable
                  key={c}
                  onPress={() => setCategory(c)}
                  className={`rounded-ctl border px-4 py-2 ${
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
          <Text className="text-[12px] uppercase tracking-wider text-faint">
            {t('project.compose.descLabel', locale)}
          </Text>
          <TextInput
            className="min-h-[120px] rounded-card border border-hair bg-raise p-4 text-[15px] text-foreground"
            placeholder={t('project.compose.descPlaceholder', locale)}
            placeholderTextColor={semantic.foregroundMuted}
            value={description}
            onChangeText={setDescription}
            multiline
            textAlignVertical="top"
          />
        </View>

        {/* Display-only Aura hint — n from AURA_WEIGHTS, never a literal (rule #10). Real award = M6. */}
        <Text className="text-[13px] text-aura">
          ✦ {t('project.compose.auraHint', locale, { n: AURA_WEIGHTS.PROJECT_CREATE })}
        </Text>

        <Button
          label={t('common.publish', locale)}
          onPress={onPublish}
          disabled={mutation.isPending}
          variant="light"
        />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
