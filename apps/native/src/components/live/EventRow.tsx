import { type Locale, type MessageKey, t } from '@athanor/i18n';
import { Pressable, Text, View } from '@/tw';
import { type EventRowData, toRowData } from '@/lib/event-row';
import { DateBadge } from './DateBadge';

export const EVENT_HREF = (id: string) => `/(modal)/event/${id}` as const;

// The row shape and its `Event` mapper live in @/lib/event-row (no JSX → reachable
// from the node test runner). Re-exported so the four panels keep importing them here.
export { toRowData };
export type { EventRowData };

/**
 * A single tappable event row. Sub line: «{city} · dal vivo · {km} km · {categoria}»
 * (physical) or «Online · {categoria}», plus «Athanor Day» when it is one. Tap → event
 * detail. One accessible button (frontend 04 §13). No vanity counts (rule #3).
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
  if (data.live) {
    // With a listener count when we have one; the bare «LIVE ora» otherwise — the state
    // used to live only in the right-side chip, which #640 folded into this line.
    parts.push(
      data.listeningCount != null
        ? t('live.online.liveNow', locale, { n: data.listeningCount })
        : t('live.chip.liveNow', locale),
    );
  } else if (data.is_online) {
    parts.push(t('live.online', locale));
  } else {
    if (data.city) parts.push(data.city);
    parts.push(t('live.live', locale));
    if (data.distanceKm) parts.push(t('live.distance', locale, { km: data.distanceKm }));
  }
  const catLabel = t(`event.cat.${data.category}` as MessageKey, locale);
  if (data.is_athanor_day) parts.push(t('live.chip.athanorDay', locale));
  parts.push(catLabel);
  const sub = parts.join(' · ');

  return (
    <Pressable
      className="flex-row items-center gap-3 rounded-card border border-hair bg-raise p-4"
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${data.title}, ${sub}`}
    >
      <DateBadge
        iso={data.starts_at}
        locale={locale}
        highlight={data.is_athanor_day}
        live={data.live}
      />
      <View className="flex-1 gap-1">
        {/* Two lines (#640): the trailing category chip cost every row its title — 6/6
            truncated in the review's measurement. The title is what the row is FOR; the
            category rides the sub-line and the live/Athanor-day state lives on DateBadge. */}
        <Text className="text-[15px] font-semibold text-foreground" numberOfLines={2}>
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
    </Pressable>
  );
}
