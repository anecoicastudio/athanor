import { useState } from 'react';
import { Image } from 'react-native';
import { KeyboardAvoiding } from '@/components/KeyboardAvoiding';
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
import { devWarn } from '@/lib/log';
import { type PickedMedia } from '@/lib/media/pick';
import { extractVideoPoster } from '@/lib/media/poster';
import { withTimeout } from '@/lib/media/with-timeout';
import {
  postMediaPath,
  postMediaThumbPath,
  processAndUpload,
  uploadErrorKey,
  uploadLocalFile,
} from '@/lib/media/upload';
import { supabase } from '@/lib/supabase';
import { Screen } from '@/components/Screen';

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
              thumb_path:
                item.kind === 'video'
                  ? await uploadPoster(authorId, post.id, index, up.localUri, up.duration_s)
                  : null,
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
    onError: (err) => {
      setError(t(uploadErrorKey(err), locale));
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
    <KeyboardAvoiding>
      <Screen>
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
                  {item.kind === 'video' ? (
                    // An <Image> handed a video file URI draws nothing (#318) — this tile was a
                    // blank box with a ▶ badge. Same no-poster state the feed card falls back to:
                    // dark fill, centred faint ▶ (MomentTile pairing — wrapper announces, glyph
                    // is decorative).
                    <View
                      className="h-20 w-20 items-center justify-center rounded-[8px] bg-raise-2"
                      accessible
                      accessibilityLabel={t('media.noPoster.video', locale)}
                    >
                      <Text
                        className="text-2xl text-faint"
                        accessibilityElementsHidden
                        importantForAccessibility="no-hide-descendants"
                      >
                        ▶
                      </Text>
                    </View>
                  ) : (
                    <Image
                      source={{ uri: item.uri }}
                      style={{ width: 80, height: 80, borderRadius: 8 }}
                      resizeMode="cover"
                    />
                  )}
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
            <SectionLabel>{t('post.compose.catLabel', locale)}</SectionLabel>
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
      </Screen>
    </KeyboardAvoiding>
  );
}

/**
 * Bound the poster step, so a decoder that never settles cannot hold the publish (#462).
 *
 * `extractVideoPoster` has no timeout of its own — neither `replaceAsync` nor
 * `generateThumbnailsAsync` is bounded — and an iCloud-backed `PHAsset` can take a very long
 * time or never settle. It matters more here than anywhere: this is awaited inside a
 * `Promise.all` over every attached item and `MEDIA_LIMITS.MAX_POST_MEDIA` is 10, so one
 * publish could sit behind ten unbounded extractions with the videos already in Storage.
 * `withTimeout` never rejects, so the deadline costs a thumbnail and saves the post.
 *
 * The controller is what makes the deadline mean something to the work rather than only to the
 * wait (#449): `extractVideoPoster` checks the signal between native calls and skips the rest.
 * It buys the steps not yet started, never the one in flight — releasing a `VideoPlayer`
 * mid-`AVAssetImageGenerator` runs its deinit off the main thread, which crashes. One
 * controller per item, not one for the batch: a slow poster on item 3 must not cancel item 7's.
 */
async function uploadPoster(
  uid: string,
  postId: string,
  index: number,
  localUri: string,
  durationS: number | null | undefined,
): Promise<string | null> {
  const posterAbort = new AbortController();
  return withTimeout(
    extractAndUploadPoster(uid, postId, index, localUri, durationS, posterAbort.signal),
    MEDIA_LIMITS.VIDEO_POSTER_TIMEOUT_MS,
    null,
    { onTimeout: () => posterAbort.abort() },
  );
}

/**
 * Extract a poster frame from an uploaded post video and put it beside the mp4, returning the
 * storage path for `thumb_path` — or `null` if any part of that did not work out.
 *
 * Swallowing the failure is the design, exactly as in `use-moment-upload` (#281 rationale): by
 * the time this runs the video is already in Storage and the member is waiting on their post;
 * failing the publish because a decoder would not give up a frame would trade a working post for
 * a missing one. The feed card reads the null and draws its own no-poster state instead.
 *
 * Extraction reads `processAndUpload`'s *processed* `localUri`, not the picked one — see the
 * caution in `upload.ts`: the day `processVideo` transcodes, a poster taken from the picked file
 * would be a frame of a video nobody uploaded.
 *
 * Swallowed is not the same as unnamed, which is what this used to be (#462): a bare `catch {}`
 * threw the reason away entirely, and in Expo Go the dev console is the only telemetry there is
 * — `Sentry.init` is a hard no-op on that runtime (#452), so a failure discarded here was a
 * report nobody could ever file. `devWarn` is `__DEV__`-only, so it ships nothing.
 *
 * The poster shares the video's `{uid}/{postId}/…` folder, so the owner-write post-media storage
 * policies cover it, and `media_process_enqueue` strips it server-side like any other object in
 * the bucket.
 */
async function extractAndUploadPoster(
  uid: string,
  postId: string,
  index: number,
  localUri: string,
  durationS: number | null | undefined,
  extractSignal: AbortSignal,
): Promise<string | null> {
  try {
    const poster = await extractVideoPoster(localUri, durationS, extractSignal);
    if (!poster) return null;
    const path = postMediaThumbPath(uid, postId, index);
    await uploadLocalFile(poster.uri, { bucket: 'post-media', path }, 'image/jpeg');
    return path;
  } catch (err) {
    devWarn('post.poster', err);
    return null;
  }
}
