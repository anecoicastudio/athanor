import { type Locale, type MessageKey, t } from '@athanor/i18n';
import type { EventCategory } from '@athanor/schemas';
import { Pressable, Text, View } from '@/tw';
import { DateBadge } from './DateBadge';

export type EventRowData = {
  id: string;
  title: string;
  category: EventCategory;
  starts_at: string;
  venue: string | null;
  city: string | null;
  is_online?: boolean;
  is_athanor_day?: boolean;
  live?: boolean;
  /** Pre-formatted "x km" sub-fragment (Vicino/Mappa); omit elsewhere. */
  distanceKm?: string | null;
};

/**
 * A single tappable event row. Sub line: «{city} · dal vivo · {km} km» (physical) or
 * «Online». Tap → event detail. One accessible button (frontend 04 §13). No vanity
 * counts (rule #3).
 */
export function EventRow({
  data,
  locale,
  onPress,
}: {
  data: EventRowData;
  locale: Locale;
  onPress: () => void;
}) {
  const parts: string[] = [];
  if (data.is_online) {
    parts.push(t('live.online', locale));
  } else {
    if (data.city) parts.push(data.city);
    parts.push(t('live.live', locale));
    if (data.distanceKm) parts.push(t('live.distance', locale, { km: data.distanceKm }));
  }
  const sub = parts.join(' · ');
  const catLabel = t(`event.cat.${data.category}` as MessageKey, locale);

  return (
    <Pressable
      className="flex-row items-center gap-3 rounded-card border border-hair bg-raise p-4"
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${data.title}, ${sub}, ${catLabel}`}
    >
      <DateBadge
        iso={data.starts_at}
        locale={locale}
        highlight={data.is_athanor_day}
        live={data.live}
      />
      <View className="flex-1 gap-1">
        <Text className="text-[15px] font-semibold text-foreground" numberOfLines={1}>
          {data.title}
        </Text>
        <Text className="text-[13px] text-faint" numberOfLines={1}>
          {sub}
        </Text>
      </View>
      <View
        className={`rounded-ctl border px-3 py-1 ${
          data.is_athanor_day || data.live
            ? 'border-aura-line bg-aura-soft'
            : 'border-hair bg-background'
        }`}
      >
        <Text
          className={`text-[12px] ${data.is_athanor_day || data.live ? 'text-aura' : 'text-faint'}`}
        >
          {data.live
            ? t('live.chip.liveNow', locale)
            : data.is_athanor_day
              ? t('live.chip.athanorDay', locale)
              : catLabel}
        </Text>
      </View>
    </Pressable>
  );
}
