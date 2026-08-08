import { useState } from 'react';
import { Image, KeyboardAvoidingView, Platform } from 'react-native';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { addPostMedia, createPost, postKeys } from '@athanor/api';
import { semantic } from '@athanor/config';
import { MEDIA_LIMITS, derivePostType } from '@athanor/core';
import { type MessageKey, t } from '@athanor/i18n';
import type { PostCategory, PostMediaInsert } from '@athanor/schemas';
import { Pressable, ScrollView, Text, TextInput, View } from '@/tw';
import { Button } from '@/components/Button';
import { MediaSheet } from '@/components/media/MediaSheet';
import { ModalHeader } from '@/components/ModalHeader';
import { SectionLabel } from '@/components/SectionLabel';
import { useAuth } from '@/lib/auth-context';
import { type PickedMedia } from '@/lib/media/pick';
import { postMediaPath, processAndUpload } from '@/lib/media/upload';
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
  const [items, setItems] = useState<PickedMedia[]>([]);
  const [sheetOpen, setSheetOpen] = useState(false);

  const mutation = useMutation({
    mutationFn: async () => {
      if (!authorId) throw new Error('no session');
      const type = derivePostType(items.map((i) => i.kind));
      const post = await createPost(supabase, {
        author_id: authorId,
        category,
        type,
        body,
        is_step: isStep,
        tags: [],
      });
      if (items.length > 0) {
        const rows: PostMediaInsert[] = await Promise.all(
          items.map(async (item, index) => {
            const path = postMediaPath(authorId, post.id, index, item.kind);
            const up = await processAndUpload(item, { bucket: 'post-media', path });
            return {
              post_id: post.id,
              kind: item.kind,
              storage_path: up.storage_path,
              position: index,
              width: up.width ?? null,
              height: up.height ?? null,
              duration_s: up.duration_s ?? null,
            } satisfies PostMediaInsert;
          }),
        );
        await addPostMedia(supabase, rows);
      }
      return post;
    },
    onSuccess: async () => {
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      await queryClient.invalidateQueries({ queryKey: postKeys.all });
      router.back();
    },
    onError: () => {
      setError(t('media.failed', locale));
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

  const onPickMedia = (m: PickedMedia) => {
    setItems((prev) => (prev.length < MEDIA_LIMITS.MAX_POST_MEDIA ? [...prev, m] : prev));
  };

  const removeItem = (index: number) => {
    setItems((prev) => prev.filter((_, i) => i !== index));
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View className="flex-1 bg-background">
        <ModalHeader title={t('create.post.title', locale)} backLabel={t('common.back', locale)} />
        <ScrollView className="flex-1" contentContainerClassName="gap-5 px-5 pb-8">
          <Text className="text-[14px] text-faint">{t('create.post.desc', locale)}</Text>

          <TextInput
            className="min-h-[120px] rounded-hero border border-hair bg-raise p-4 text-[15px] text-foreground"
            placeholder={t('post.compose.placeholder', locale)}
            placeholderTextColor={semantic.foregroundMuted}
            value={body}
            onChangeText={setBody}
            multiline
            textAlignVertical="top"
          />
          {error ? <Text className="text-[13px] text-error">{error}</Text> : null}

          {/* Attach affordance — flat, no glow (rule #4) */}
          <Pressable
            className="flex-row items-center gap-2 rounded-ctl border border-hair bg-raise px-4 py-3"
            onPress={() => setSheetOpen(true)}
            disabled={mutation.isPending || items.length >= MEDIA_LIMITS.MAX_POST_MEDIA}
            accessibilityRole="button"
          >
            <Text
              className={`text-[14px] ${items.length >= MEDIA_LIMITS.MAX_POST_MEDIA ? 'text-faint' : 'text-foreground'}`}
            >
              {t('post.compose.attach', locale)}
            </Text>
          </Pressable>

          {/* Preview tiles */}
          {items.length > 0 ? (
            <View className="flex-row flex-wrap gap-2">
              {items.map((item, index) => (
                <View key={index} className="relative h-20 w-20">
                  <Image
                    source={{ uri: item.uri }}
                    style={{ width: 80, height: 80, borderRadius: 8 }}
                    resizeMode="cover"
                  />
                  {/* Video indicator */}
                  {item.kind === 'video' ? (
                    <View className="absolute bottom-1 left-1">
                      <Text className="text-[12px] text-foreground">▶</Text>
                    </View>
                  ) : null}
                  {/* Uploading dim overlay */}
                  {mutation.isPending ? (
                    <View
                      className="absolute inset-0 items-center justify-center rounded-[8px] bg-surface-muted"
                      style={{ opacity: 0.6 }}
                    />
                  ) : null}
                  {/* Remove button — hidden while uploading */}
                  {!mutation.isPending ? (
                    <Pressable
                      className="absolute right-[-6px] top-[-6px] h-5 w-5 items-center justify-center rounded-full bg-raise"
                      onPress={() => removeItem(index)}
                      accessibilityRole="button"
                      hitSlop={8}
                    >
                      <Text className="text-[11px] text-faint">✕</Text>
                    </Pressable>
                  ) : null}
                </View>
              ))}
            </View>
          ) : null}

          {/* Uploading indicator */}
          {mutation.isPending && items.length > 0 ? (
            <Text className="text-[13px] text-faint">
              {t('media.uploadingIndeterminate', locale)}
            </Text>
          ) : null}

          <MediaSheet
            visible={sheetOpen}
            allowVideo
            locale={locale}
            onPick={onPickMedia}
            onClose={() => setSheetOpen(false)}
            onError={() => setError(t('media.failed', locale))}
          />

          <View className="gap-2">
            <SectionLabel>
              {t('post.compose.catLabel', locale)}
            </SectionLabel>
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
                      {t(`feed.filter.${c}` as MessageKey, locale)}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          <Pressable
            className="flex-row items-center justify-between rounded-card border border-hair bg-raise p-5"
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

          {/* P2.5 hint-truth: no create-hint — the engine never rewards posting (anti-gaming). */}
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
