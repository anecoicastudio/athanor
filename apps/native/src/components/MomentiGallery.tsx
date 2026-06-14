import { t } from '@auria/i18n';
import type { Locale } from '@auria/schemas';
import type { Moment } from '@/types/moment';
import { Pressable, Text, View } from '@/tw';
import { EmptyState } from '@/components/EmptyState';
import { SectionLabel } from '@/components/SectionLabel';
import { MomentAddTile, MomentTile } from '@/components/MomentTile';

/**
 * "I tuoi Momenti" — the Profilo gallery section (frontend `01` §3.4 item 6).
 * Header + "Vedi tutti" → full grid; a 3-col gallery of own momenti + the
 * trailing add tile. M1 frame-only: empty for real new users (types/moment.ts);
 * create/upload + the live source land at M3.
 */
export function MomentiGallery({
  moments,
  locale,
  onOpen,
  onSeeAll,
  onAdd,
}: {
  moments: Moment[];
  locale: Locale;
  onOpen: (index: number) => void;
  onSeeAll: () => void;
  onAdd: () => void;
}) {
  const empty = moments.length === 0;
  return (
    <View className="gap-3">
      <View className="flex-row items-center justify-between">
        <SectionLabel>{t('profile.moments.title', locale)}</SectionLabel>
        <Pressable accessibilityRole="link" hitSlop={8} onPress={onSeeAll}>
          <Text className="text-[13px] text-aura">{t('common.seeAll', locale)}</Text>
        </Pressable>
      </View>

      <View className="flex-row flex-wrap">
        {moments.map((m, i) => (
          <View key={m.id} className="w-1/3 p-0.5">
            <MomentTile moment={m} variant="gallery" onPress={() => onOpen(i)} />
          </View>
        ))}
        <View className="w-1/3 p-0.5">
          <MomentAddTile variant="gallery" label={t('moment.add', locale)} onPress={onAdd} />
        </View>
      </View>

      {empty ? <EmptyState>{t('profile.moments.empty', locale)}</EmptyState> : null}
    </View>
  );
}
