import { useEffect, useRef, useState } from 'react';
import { Image } from 'react-native';
import * as Haptics from 'expo-haptics';
import { t } from '@athanor/i18n';
import { KeyboardAvoiding } from '@/components/KeyboardAvoiding';
import { Pressable, ScrollView, Text, View } from '@/tw';
import { Button } from '@/components/Button';
import { Field } from '@/components/Field';
import { MediaSheet } from '@/components/media/MediaSheet';
import { ModalHeader } from '@/components/ModalHeader';
import { useLocale } from '@/hooks/use-locale';
import { useAuth } from '@/lib/auth-context';
import { useGuardedBack } from '@/lib/modal-exit';
import { type PickedMedia } from '@/lib/media/pick';
import { uploadErrorKey } from '@/lib/media/upload';
import { useStoryUpload } from '@/lib/media/use-story-upload';
import { Screen } from '@/components/Screen';
import { useToast } from '@/components/ToastHost';

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
  const leave = useGuardedBack();
  const locale = useLocale();
  const uid = session?.user.id;

  const [media, setMedia] = useState<PickedMedia | null>(null);
  const [caption, setCaption] = useState('');
  const [isStep, setIsStep] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { addSegment, isUploading } = useStoryUpload(uid);
  const { showToast } = useToast();

  /**
   * The publish runs in a floating async IIFE, so it settles whether or not this screen is
   * still mounted — and the exit stays live while it works. Without this ref a segment that
   * lands late would navigate the member off whatever screen they reached, and a late failure
   * would `setError` into a component nobody is looking at (#579). Same ref, same reasons, as
   * `post-compose`.
   */
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

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
        // Outside the guard on purpose — the toast host is global, so it reaches the member
        // even when the publish settled after they left. `'success'`, not `'moment'`: the ✦
        // belongs to the ring this segment lights, not to the act of posting it (rule 4).
        showToast(t('story.toast.published', locale), 'success');
        if (mounted.current) leave();
      } catch (err) {
        const key = uploadErrorKey(err);
        // Inline while they are here (it sits under the pick they would change); the toast is
        // the only surface left once they are not.
        if (mounted.current) setError(t(key, locale));
        else showToast(t(key, locale));
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

          <Field
            multiline
            maxLength={280}
            placeholder={t('story.add.captionPlaceholder', locale)}
            value={caption}
            onChangeText={setCaption}
          />
          {error ? <Text className="text-[13px] text-error">{error}</Text> : null}

          {/* The same toggle as `post-compose.tsx`, and it had the same defect — role, state and
              name all missing (#635). Fixed here too so the two composers cannot drift. */}
          <Pressable
            className="flex-row items-center justify-between rounded-card border border-hair bg-raise p-5"
            accessibilityRole="switch"
            accessibilityState={{ checked: isStep }}
            accessibilityLabel={t('story.add.stepTitle', locale)}
            accessibilityHint={t('story.add.stepDesc', locale)}
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
            onError={(key) => setError(t(key, locale))}
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
