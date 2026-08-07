import { type Locale, type MessageKey, t } from '@athanor/i18n';
import type { Event, EventCategory } from '@athanor/schemas';
import { Pressable, Text, View } from '@/tw';
import { DateBadge } from './DateBadge';

export const EVENT_HREF = (id: string) => `/(modal)/event/${id}` as const;

export type EventRowData = {
  id: string;
  title: string;
  category: EventCategory;
  starts_at: string;
  venue: string | null;
  city: string | null;
  is_online?: boolean;
  is_kairos_day?: boolean;
  is_athanor_day?: boolean;
  live?: boolean;
  /** Premium (Kairos/Athanor-Day) event AND the viewer is not a Circle member → show the lock marker. */
  premiumLocked?: boolean;
  /** Pre-formatted "x km" sub-fragment (Vicino/Mappa); omit elsewhere. */
  distanceKm?: string | null;
  /** Realtime live-listener count; when present on a live row → «In diretta ora · {n} in ascolto». */
  listeningCount?: number | null;
};

/** Map a full `Event` to the row shape, deriving live + premium-lock state. */
export function toRowData(e: Event, premiumEnabled: boolean): EventRowData {
  const live = !!e.live_started_at && !e.live_ended_at;
  const isPremium = e.is_kairos_day || e.is_athanor_day;
  return {
    id: e.id,
    title: e.title,
    category: e.category,
    starts_at: e.starts_at,
    venue: e.venue,
    city: e.city,
    is_online: e.is_online,
    is_kairos_day: e.is_kairos_day,
    is_athanor_day: e.is_athanor_day,
    premiumLocked: isPremium && !premiumEnabled,
    live,
  };
}

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
  if (data.live && data.listeningCount != null) {
    parts.push(t('live.online.liveNow', locale, { n: data.listeningCount }));
  } else if (data.is_online) {
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
        {data.premiumLocked ? (
          <View
            className="mt-1 flex-row items-center gap-1 self-start rounded-full border border-hair bg-raise-2 px-2 py-0.5"
            accessibilityLabel={`${t('circle.gate.a11y', locale)} — ${t('common.locked', locale)}`}
          >
            <Text className="text-[11px] text-muted-foreground" accessibilityLabel="">
              🔒
            </Text>
            <Text className="text-[11px] text-muted-foreground">
              {t('circle.gate.premiumEvents', locale)}
            </Text>
          </View>
        ) : null}
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
