import { ActivityIndicator } from 'react-native';
import { t } from '@athanor/i18n';
import type { Locale } from '@athanor/schemas';
import { Pressable, Text, View } from '@/tw';

type Props = {
  locale: Locale;
  status: 'idle' | 'uploading' | 'done' | 'error';
  onPick: () => void;
  onRecord: () => void;
};

/**
 * Step-4 video upload tile for the candidacy wizard (07 §3.4, prototype `.cand .vid`).
 * Three states: idle (prompt to record/pick), uploading (spinner), done (✦ lit).
 * No glow — uploading a video is not yet a moment (glow lives on the success overlay).
 */
export function VideoUploadTile({ locale, status, onPick, onRecord }: Props) {
  return (
    <View className="gap-3">
      {/* Preview / status area */}
      <View className="items-center justify-center rounded-card border border-hair bg-raise py-10">
        {status === 'uploading' ? (
          <ActivityIndicator />
        ) : (
          <Text
            className={status === 'done' ? 'text-2xl text-aura' : 'text-2xl text-muted-foreground'}
          >
            {status === 'done' ? '✦' : '◓'}
          </Text>
        )}
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
