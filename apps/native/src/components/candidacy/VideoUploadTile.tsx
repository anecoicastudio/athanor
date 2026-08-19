import { ActivityIndicator, Linking } from 'react-native';
import { t } from '@athanor/i18n';
import type { Locale } from '@athanor/schemas';
import { Pressable, Text, View } from '@/tw';
import { MediaFrame } from '@/components/media/MediaFrame';
import {
  type UploadStatus,
  type VideoFailure,
  videoStatusMessage,
  videoStatusOffersSettings,
  videoTilePreview,
} from '@/lib/candidacy-video-status';

type Props = {
  locale: Locale;
  status: UploadStatus;
  /** Why the attempt failed, when `status` is `'error'`. Null otherwise. */
  failure: VideoFailure | null;
  /** Whole percent 0–100, or null while the total is unknown. */
  progress: number | null;
  /**
   * Local file URI of the poster frame just extracted, or null when there is none. Local, not
   * signed: the JPEG is on the device the moment the upload reports done.
   */
  posterUri: string | null;
  onPick: () => void;
  onRecord: () => void;
  onCancel: () => void;
};

/**
 * Step-4 video upload tile for the candidacy wizard (07 §3.4, prototype `.cand .vid`).
 * States: idle (prompt to record/pick), uploading (true percentage + cancel, #294),
 * canceled/stalled/error (each says which; record/pick below retries — same key, upsert
 * overwrites), done (the poster frame, or a lit ✦ when there is none). No glow — uploading a
 * video is not yet a moment (glow lives on the success overlay).
 *
 * The done state used to be the ✦ and nothing else, so a video that uploaded perfectly gave the
 * member no way to tell WHICH video had gone up — or, when poster extraction was quietly losing
 * a race on iOS, whether anything had. The frame answers both. It renders from the extractor's
 * local JPEG rather than a signed URL, so it costs no round-trip and appears with the status.
 * `videoTilePreview` owns the three-way choice, unit-tested next door: this file is a `.tsx` and
 * the node test runner cannot collect it, the same reason `videoStatusMessage` lives there.
 *
 * Every failure names itself (#412). This tile used to draw copy for `canceled` and `stalled`
 * only, so `error` fell through to the same grey `◓` as idle: a blocked permission, an over-cap
 * video, a refused write and a native throw were all rendered as «nothing happened». The
 * status→key decision is `videoStatusMessage`, unit-tested next door; a `blocked` grant also
 * gets the Settings route, because it is the one failure the member cannot clear from in here.
 */
export function VideoUploadTile({
  locale,
  status,
  failure,
  progress,
  posterUri,
  onPick,
  onRecord,
  onCancel,
}: Props) {
  const message = videoStatusMessage(status, failure);
  const offersSettings = videoStatusOffersSettings(status, failure);
  const preview = videoTilePreview(status, posterUri);

  return (
    <View className="gap-3">
      {/* Preview / status area */}
      <View className="items-center justify-center rounded-card border border-hair bg-raise py-10">
        {preview === 'uploading' ? (
          <>
            <ActivityIndicator />
            <Text className="mt-3 text-[13px] text-muted-foreground">
              {progress === null
                ? t('media.uploadingIndeterminate', locale)
                : t('media.uploading', locale, { pct: progress })}
            </Text>
            <Pressable
              onPress={onCancel}
              className="mt-3 rounded-ctl border border-hair px-4 py-2"
              accessibilityRole="button"
              accessibilityLabel={t('media.cancel', locale)}
            >
              <Text className="text-[13px] font-semibold text-foreground">
                {t('media.cancel', locale)}
              </Text>
            </Pressable>
          </>
        ) : preview === 'poster' && posterUri ? (
          // `compact` is omitted deliberately, for the same reason as the ballot card: it is for
          // tile-sized surfaces, and this frame is wide enough that the unavailable sentence
          // fits and should be read. `isLoading` is false because there is nothing to wait for —
          // the file is on disk, so the only states left are drawn and broken.
          <View accessible accessibilityLabel={t('candidacy.step4.preview', locale)}>
            <MediaFrame
              kind="video"
              url={posterUri}
              isLoading={false}
              locale={locale}
              className="aspect-video w-2/3 rounded-ctl"
            />
          </View>
        ) : (
          <Text
            className={status === 'done' ? 'text-2xl text-aura' : 'text-2xl text-muted-foreground'}
          >
            {status === 'done' ? '✦' : '◓'}
          </Text>
        )}
        {message ? (
          <Text className="mt-3 px-6 text-center text-[13px] text-error">{t(message, locale)}</Text>
        ) : null}
        {offersSettings ? (
          // The OS will not prompt again, so «Consenti» would be a dead button. Same deep link
          // the MediaSheet primer offers on a blocked grant (PermissionPrimer).
          <Pressable
            onPress={() => void Linking.openSettings()}
            className="mt-3 rounded-ctl border border-hair px-4 py-2"
            accessibilityRole="button"
            accessibilityLabel={t('permission.openSettings', locale)}
          >
            <Text className="text-[13px] font-semibold text-foreground">
              {t('permission.openSettings', locale)}
            </Text>
          </Pressable>
        ) : null}
        <Text className="mt-3 text-[13px] text-muted-foreground">
          {t('candidacy.step4.uploadHint', locale)}
        </Text>
      </View>

      {/* Action buttons: Record (primary) + Pick from library (secondary) */}
      <View className="flex-row gap-3">
        <Pressable
          onPress={onRecord}
          className="grow items-center rounded-ctl border border-hair bg-raise py-3"
          accessibilityRole="button"
          accessibilityLabel={t('candidacy.step4.upload', locale)}
        >
          <Text className="text-[14px] font-semibold text-foreground">
            {t('candidacy.step4.upload', locale)}
          </Text>
        </Pressable>
        <Pressable
          onPress={onPick}
          className="grow items-center rounded-ctl border border-hair bg-raise py-3"
          accessibilityRole="button"
          accessibilityLabel={t('media.sheet.library', locale)}
        >
          <Text className="text-[14px] font-semibold text-foreground">
            {t('media.sheet.library', locale)}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}
