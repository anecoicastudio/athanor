import { Modal } from 'react-native';
import { t } from '@auria/i18n';
import type { Locale } from '@auria/schemas';
import type { Moment } from '@/types/moment';
import { Pressable, Text, View } from '@/tw';

/**
 * Fullscreen Momento viewer (frontend `01` §3.6). Opened from the Profilo
 * gallery or the full grid. M1 frame-only: built + typed, but a real new user
 * has no momenti so it stays closed; M3 supplies media + video playback.
 */
export function Lightbox({
  moments,
  index,
  locale,
  onClose,
  onIndexChange,
}: {
  moments: Moment[];
  index: number | null;
  locale: Locale;
  onClose: () => void;
  onIndexChange: (index: number) => void;
}) {
  const open = index !== null && index >= 0 && index < moments.length;
  const current = open ? moments[index] : null;

  const step = () => {
    if (index === null || moments.length === 0) return;
    onIndexChange((index + 1) % moments.length);
  };

  return (
    <Modal visible={open} transparent animationType="fade" onRequestClose={onClose}>
      <View className="flex-1 bg-background">
        {/* lb-top */}
        <View className="flex-row items-center justify-between px-5 pb-4 pt-14">
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('common.back', locale)}
            hitSlop={8}
            onPress={onClose}
          >
            <Text className="text-2xl text-foreground">✕</Text>
          </Pressable>
          <Text className="text-sm text-faint">{t('lightbox.label', locale)}</Text>
          <View className="w-6" />
        </View>

        {/* lb-stage — tap → next */}
        <Pressable className="flex-1 items-center justify-center px-5" onPress={step}>
          <View className="aspect-[4/5] w-full justify-end overflow-hidden rounded-card bg-raise">
            {current?.type === 'video' ? (
              <View className="absolute inset-0 items-center justify-center">
                <Text className="text-4xl text-foreground">▶</Text>
              </View>
            ) : null}
          </View>
        </Pressable>

        {/* lb-cap */}
        {current?.caption ? (
          <Text className="px-5 pb-3 text-center text-foreground">{current.caption}</Text>
        ) : null}

        {/* lb-nav dots */}
        {moments.length > 1 ? (
          <View className="flex-row items-center justify-center gap-2 pb-10">
            {moments.map((m, i) => (
              <View
                key={m.id}
                className={`h-1.5 w-1.5 rounded-full ${i === index ? 'bg-aura' : 'bg-faint'}`}
              />
            ))}
          </View>
        ) : (
          <View className="pb-10" />
        )}
      </View>
    </Modal>
  );
}
