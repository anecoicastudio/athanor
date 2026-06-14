import { useState } from 'react';
import { KeyboardAvoidingView, Platform } from 'react-native';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createPost, postKeys } from '@athanor/api';
import { semantic } from '@athanor/config';
import { AURA_WEIGHTS } from '@athanor/core';
import { type MessageKey, t } from '@athanor/i18n';
import type { PostCategory } from '@athanor/schemas';
import { Pressable, ScrollView, Text, TextInput, View } from '@/tw';
import { Button } from '@/components/Button';
import { useAuth } from '@/lib/auth-context';
import { supabase } from '@/lib/supabase';

const CATEGORIES: PostCategory[] = ['business', 'human', 'creative', 'evolution'];

export default function PostComposeScreen() {
  const { profile, session } = useAuth();
  const router = useRouter();
  const queryClient = useQueryClient();
  const locale = profile?.locale ?? 'it';
  const [body, setBody] = useState('');
  const [category, setCategory] = useState<PostCategory>('human');
  const [isStep, setIsStep] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const authorId = session?.user.id;

  const mutation = useMutation({
    mutationFn: () => {
      if (!authorId) throw new Error('no session');
      // text-only this slice — no tag UI; tags default to [] (rule: schema is the source).
      return createPost(supabase, {
        author_id: authorId,
        category,
        type: 'text',
        body,
        is_step: isStep,
        tags: [],
      });
    },
    onSuccess: async () => {
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      await queryClient.invalidateQueries({ queryKey: postKeys.all });
      router.back();
    },
  });

  const onPublish = () => {
    if (body.trim().length === 0) {
      setError(t('post.compose.error', locale));
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
          <Text className="text-2xl text-foreground">{t('create.post.title', locale)}</Text>
          <Text className="text-[14px] text-faint">{t('create.post.desc', locale)}</Text>
        </View>

        <TextInput
          className="min-h-[120px] rounded-card border border-hair bg-raise p-4 text-[15px] text-foreground"
          placeholder={t('post.compose.placeholder', locale)}
          placeholderTextColor={semantic.foregroundMuted}
          value={body}
          onChangeText={setBody}
          multiline
          textAlignVertical="top"
        />
        {error ? <Text className="text-[13px] text-error">{error}</Text> : null}

        <View className="gap-2">
          <Text className="text-[12px] uppercase tracking-wider text-faint">
            {t('post.compose.catLabel', locale)}
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
                    {t(`feed.filter.${c}` as MessageKey, locale)}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        <Pressable
          className="flex-row items-center justify-between rounded-card border border-hair bg-raise p-4"
          onPress={() => setIsStep((v) => !v)}
        >
          <View className="flex-1 pr-4">
            <Text className="text-[15px] text-foreground">
              {t('post.compose.stepTitle', locale)}
            </Text>
            <Text className="text-[13px] text-faint">{t('post.compose.stepDesc', locale)}</Text>
          </View>
          <Text className={isStep ? 'text-aura' : 'text-faint'}>{isStep ? '✦' : '○'}</Text>
        </Pressable>

        {/* Display-only Aura hint — n from AURA_WEIGHTS, never a literal (rule #10). Real award = M6. */}
        <Text className="text-[13px] text-aura">
          ✦ {t('post.compose.auraHint', locale, { n: AURA_WEIGHTS.POST_CREATE })}
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
