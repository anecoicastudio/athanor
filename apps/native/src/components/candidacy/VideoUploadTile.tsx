import { ActivityIndicator } from 'react-native';
import { t } from '@athanor/i18n';
import type { Locale } from '@athanor/schemas';
import { Pressable, Text, View } from '@/tw';
import type { UploadStatus } from '@/lib/media/use-candidacy-upload';

type Props = {
  locale: Locale;
  status: UploadStatus;
  /** Whole percent 0–100, or null while the total is unknown. */
  progress: number | null;
  onPick: () => void;
  onRecord: () => void;
  onCancel: () => void;
};

/**
 * Step-4 video upload tile for the candidacy wizard (07 §3.4, prototype `.cand .vid`).
 * States: idle (prompt to record/pick), uploading (true percentage + cancel, #294),
 * canceled/stalled (each says which; record/pick below retries — same key, upsert
 * overwrites), error, done (✦ lit). No glow — uploading a video is not yet a moment
 * (glow lives on the success overlay).
 */
export function VideoUploadTile({ locale, status, progress, onPick, onRecord, onCancel }: Props) {
  return (
    <View className="gap-3">
      {/* Preview / status area */}
      <View className="items-center justify-center rounded-card border border-hair bg-raise py-10">
        {status === 'uploading' ? (
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
        ) : (
          <Text
            className={status === 'done' ? 'text-2xl text-aura' : 'text-2xl text-muted-foreground'}
          >
            {status === 'done' ? '✦' : '◓'}
          </Text>
        )}
        {status === 'canceled' || status === 'stalled' ? (
          <Text className="mt-3 text-[13px] text-error">
            {t(status === 'canceled' ? 'media.canceled' : 'media.stalled', locale)}
          </Text>
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
