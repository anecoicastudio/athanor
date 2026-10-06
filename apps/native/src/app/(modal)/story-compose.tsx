import { useEffect, useRef, useState } from 'react';
import { Image } from 'react-native';
import * as Haptics from 'expo-haptics';
import { galleria } from '@athanor/config';
import { t } from '@athanor/i18n';
import { KeyboardAvoiding } from '@/components/KeyboardAvoiding';
import { Pressable, ScrollView, Text, View, cn } from '@/tw';
import { Button } from '@/components/Button';
import { Field } from '@/components/Field';
import { CloseIcon, PlayGlyph } from '@/components/glyphs';
import { MediaSheet } from '@/components/media/MediaSheet';
import { ModalHeader } from '@/components/ModalHeader';
import { Row } from '@/components/Row';
import { RowGroup } from '@/components/RowGroup';
import { useDirtyGuard } from '@/hooks/use-dirty-guard';
import { useLocale } from '@/hooks/use-locale';
import { isDraftDirty } from '@/lib/dirty-guard';
import { useAuth } from '@/lib/auth-context';
import { useGuardedBack } from '@/lib/modal-exit';
import { PRESS_DIM } from '@/lib/press';
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
 * Flat surfaces only (rule #4): composing a step is not itself a moment. What it leaves behind
 * is the foreground ring on your disc in the rail.
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
  // Set before the exit below, not derived from `isUploading`: the upload has already
  // finished by the time this screen pops itself, so the flag is what stops the guard
  // asking a member to confirm discarding a segment that is already published (#636).
  const [published, setPublished] = useState(false);

  const { addSegment, isUploading } = useStoryUpload(uid);
  const { showToast } = useToast();

  const [baseline] = useState(() => ({ media, caption, isStep }));
  useDirtyGuard({
    dirty: isDraftDirty(baseline, { media, caption, isStep }),
    saving: isUploading,
    submitted: published,
  });

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
        // even when the publish settled after they left. `'success'`, not `'moment'`:
        // posting a segment is not a moment (rule 4).
        showToast(t('story.toast.published', locale), 'success');
        setPublished(true);
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
        {/* `handled`: the first tap on a control lands on it instead of only dismissing the
            keyboard (#748). */}
        <ScrollView
          className="flex-1"
          contentContainerClassName="gap-[26px] px-5 pb-8"
          keyboardShouldPersistTaps="handled"
        >
          <Text className="type-small text-muted-foreground">{t('story.add.desc', locale)}</Text>

          {/* Attach: an outline pill (the prototype's `pill o`). One segment per publish: a
              re-pick replaces. */}
          <Button
            variant="outline"
            label={t('story.add.attach', locale)}
            onPress={() => setSheetOpen(true)}
            disabled={isUploading}
          />

          {media ? (
            <View className="relative h-40 w-40">
              {media.kind === 'video' ? (
                // An <Image> handed a video file URI draws nothing (#318, swept here by #460) —
                // this tile was a blank box with a 12px ▶ pinned to its corner. Same no-poster
                // state post-compose and the feed card fall back to: the tile's fill, a centred
                // grey ▶ (MomentTile pairing — wrapper announces, glyph is decorative).
                <View
                  className="h-40 w-40 items-center justify-center rounded-[14px] border border-hair bg-surface"
                  accessible
                  accessibilityLabel={t('media.noPoster.video', locale)}
                >
                  <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
                    <PlayGlyph size={36} color={galleria.foregroundMuted} />
                  </View>
                </View>
              ) : (
                <Image
                  source={{ uri: media.uri }}
                  // The tile's hairline, as on the placeholders beside it (Greptile, PR 942).
                  style={{
                    width: 160,
                    height: 160,
                    borderRadius: 14,
                    borderWidth: 1,
                    borderColor: galleria.hair,
                  }}
                  resizeMode="cover"
                />
              )}
              {isUploading ? (
                <View className="absolute inset-0 rounded-[14px] bg-background/60" />
              ) : (
                <Pressable
                  className={cn(
                    'absolute right-[-6px] top-[-6px] h-[20px] w-[20px] items-center justify-center rounded-full border border-hair bg-surface',
                    PRESS_DIM,
                  )}
                  onPress={() => setMedia(null)}
                  accessibilityRole="button"
                  accessibilityLabel={t('media.a11y.remove', locale)}
                  hitSlop={12}
                >
                  {/* The drawn close, as on post-compose's tiles: a drawing cannot leave the
                      MEASURED 20pt box (#639), and the label names the control. */}
                  <CloseIcon size={12} color={galleria.foreground} />
                </Pressable>
              )}
            </View>
          ) : null}

          {isUploading ? (
            <Text className="type-small text-muted-foreground">
              {t('media.uploadingIndeterminate', locale)}
            </Text>
          ) : null}

          {/* The reason stands 6 under the caption; the wrapper is unconditional so it never
              remounts the field. */}
          <View className="gap-1.5">
            <Field
              multiline
              maxLength={280}
              placeholder={t('story.add.captionPlaceholder', locale)}
              value={caption}
              onChangeText={setCaption}
            />
            {error ? <Text className="text-[14px] text-error">{error}</Text> : null}
          </View>

          {/* The same toggle as `post-compose.tsx`, and it had the same defect — role, state and
              name all missing (#635); the bare ✦/○ glyph that drew its state rendered as a tiny
              unsized ○ on Android (#748). Both are one `Row checked` now, so the two composers
              cannot drift: the ROW is the control and one tap anywhere flips it once. */}
          <RowGroup>
            <Row
              title={t('story.add.stepTitle', locale)}
              description={t('story.add.stepDesc', locale)}
              checked={isStep}
              onPress={() => setIsStep((v) => !v)}
            />
          </RowGroup>

          <MediaSheet
            visible={sheetOpen}
            allowVideo
            locale={locale}
            onPick={setMedia}
            onClose={() => setSheetOpen(false)}
            onError={(key) => setError(t(key, locale))}
          />
        </ScrollView>

        {/* Publish is pinned BELOW the list (#748), the way chat pins its bar: inside the
            ScrollView the keyboard wrapper shrank the list around it and it stayed under the
            keyboard. P2.5 hint-truth: no create-hint — the engine never rewards posting. */}
        <View className="border-t border-hair bg-background px-5 py-3">
          <Button
            label={t('common.publish', locale)}
            onPress={onPublish}
            disabled={isUploading}
            variant="primary"
          />
        </View>
      </Screen>
    </KeyboardAvoiding>
  );
}
