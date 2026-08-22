import { useState } from 'react';
import { Image } from 'react-native';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { semantic } from '@athanor/config';
import { t } from '@athanor/i18n';
import { KeyboardAvoiding } from '@/components/KeyboardAvoiding';
import { Pressable, ScrollView, Text, TextInput, View } from '@/tw';
import { Button } from '@/components/Button';
import { MediaSheet } from '@/components/media/MediaSheet';
import { ModalHeader } from '@/components/ModalHeader';
import { useLocale } from '@/hooks/use-locale';
import { useAuth } from '@/lib/auth-context';
import { type PickedMedia } from '@/lib/media/pick';
import { uploadErrorKey } from '@/lib/media/upload';
import { useStoryUpload } from '@/lib/media/use-story-upload';
import { Screen } from '@/components/Screen';

/**
 * The story composer (#317) — the way INTO the evolutionary story (PRD §4.5), which shipped
 * whole (rail, viewer, reactions, pin, expiry) except this. One segment per publish: a photo or
 * a ≤60s video (caps in `storySegmentInsertSchema`; the pick layer already rejects longer),
 * optional caption, optional «passo del percorso» flag. Upload order is row-first — see
 * `useStoryUpload`.
 *
 * Flat surfaces only (rule #4): composing a step is not itself a moment — the glow belongs to
 * the ring that appears afterwards.
 */
export default function StoryComposeScreen() {
  const { session } = useAuth();
  const router = useRouter();
  const locale = useLocale();
  const uid = session?.user.id;

  const [media, setMedia] = useState<PickedMedia | null>(null);
  const [caption, setCaption] = useState('');
  const [isStep, setIsStep] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { addSegment, isUploading } = useStoryUpload(uid);

  const onPublish = () => {
    if (!media) {
      setError(t('story.add.missingMedia', locale));
      return;
    }
    setError(null);
    void (async () => {
      try {
        await addSegment({
          media,
          caption: caption.trim().length > 0 ? caption.trim() : null,
          isStep,
        });
        await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        router.back();
      } catch (err) {
        setError(t(uploadErrorKey(err), locale));
      }
    })();
  };

  return (
    <KeyboardAvoiding>
      <Screen>
        <ModalHeader title={t('story.add.title', locale)} backLabel={t('common.back', locale)} />
        <ScrollView className="flex-1" contentContainerClassName="gap-5 px-5 pb-8">
          <Text className="text-[14px] text-faint">{t('story.add.desc', locale)}</Text>

          {/* Attach affordance — flat, no glow (rule #4). One segment per publish: a re-pick replaces. */}
          <Pressable
            className="flex-row items-center gap-2 rounded-ctl border border-hair bg-raise px-4 py-3"
            onPress={() => setSheetOpen(true)}
            disabled={isUploading}
            accessibilityRole="button"
          >
            <Text className="text-[14px] text-foreground">{t('story.add.attach', locale)}</Text>
          </Pressable>

          {media ? (
            <View className="relative h-40 w-40">
              {media.kind === 'video' ? (
                // An <Image> handed a video file URI draws nothing (#318, swept here by #460) —
                // this tile was a blank box with a 12px ▶ pinned to its corner. Same no-poster
                // state post-compose and the feed card fall back to: dark fill, centred faint ▶
                // (MomentTile pairing — wrapper announces, glyph is decorative).
                <View
                  className="h-40 w-40 items-center justify-center rounded-[8px] bg-raise-2"
                  accessible
                  accessibilityLabel={t('media.noPoster.video', locale)}
                >
                  <Text
                    className="text-4xl text-faint"
                    accessibilityElementsHidden
                    importantForAccessibility="no-hide-descendants"
                  >
                    ▶
                  </Text>
                </View>
              ) : (
                <Image
                  source={{ uri: media.uri }}
                  style={{ width: 160, height: 160, borderRadius: 8 }}
                  resizeMode="cover"
                />
              )}
              {isUploading ? (
                <View
                  className="absolute inset-0 items-center justify-center rounded-[8px] bg-surface-muted"
                  style={{ opacity: 0.6 }}
                />
              ) : (
                <Pressable
                  className="absolute right-[-6px] top-[-6px] h-5 w-5 items-center justify-center rounded-full bg-raise"
                  onPress={() => setMedia(null)}
                  accessibilityRole="button"
                  hitSlop={8}
                >
                  <Text className="text-[11px] text-faint">✕</Text>
                </Pressable>
              )}
            </View>
          ) : null}

          {isUploading ? (
            <Text className="text-[13px] text-faint">
              {t('media.uploadingIndeterminate', locale)}
            </Text>
          ) : null}

          <TextInput
            className="min-h-[80px] rounded-hero border border-hair bg-raise p-4 text-[15px] text-foreground"
            placeholder={t('story.add.captionPlaceholder', locale)}
            placeholderTextColor={semantic.foregroundMuted}
            value={caption}
            onChangeText={setCaption}
            maxLength={280}
            multiline
            textAlignVertical="top"
          />
          {error ? <Text className="text-[13px] text-error">{error}</Text> : null}

          <Pressable
            className="flex-row items-center justify-between rounded-card border border-hair bg-raise p-5"
            onPress={() => setIsStep((v) => !v)}
          >
            <View className="flex-1 pr-4">
              <Text className="text-[15px] text-foreground">
                {t('story.add.stepTitle', locale)}
              </Text>
              <Text className="text-[13px] text-faint">{t('story.add.stepDesc', locale)}</Text>
            </View>
            <Text className={isStep ? 'text-aura' : 'text-faint'}>{isStep ? '✦' : '○'}</Text>
          </Pressable>

          <MediaSheet
            visible={sheetOpen}
            allowVideo
            locale={locale}
            onPick={setMedia}
            onClose={() => setSheetOpen(false)}
            onError={() => setError(t('media.failed', locale))}
          />

          {/* P2.5 hint-truth: no create-hint — the engine never rewards posting (anti-gaming). */}
          <Button
            label={t('common.publish', locale)}
            onPress={onPublish}
            disabled={isUploading}
            variant="light"
          />
        </ScrollView>
      </Screen>
    </KeyboardAvoiding>
  );
}
