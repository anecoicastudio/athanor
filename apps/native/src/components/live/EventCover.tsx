import { type Locale, type MessageKey, t } from '@athanor/i18n';
import type { Event } from '@athanor/schemas';
import { Text, View } from '@/tw';

/**
 * Event-detail hero. cover_url upload is deferred (a later slice) → render a token
 * dark surface with a faint aura band + the caption overlay (chip + display title).
 * No literal hex; no glow (a static cover is not a moment, rule #4).
 * Uses bg-surface (--color-surface: #100a1c) for the lifted dark card surface.
 */
export function EventCover({ event, locale }: { event: Event; locale: Locale }) {
  const chip = event.is_athanor_day
    ? t('live.chip.athanorDay', locale)
    : t(`event.cat.${event.category}` as MessageKey, locale);
  return (
    <View className="h-[180px] justify-end overflow-hidden rounded-hero border border-hair bg-surface">
      <View className="absolute inset-0 bg-aura-soft opacity-40" />
      <View className="gap-2 p-5">
        <View
          className={`self-start rounded-ctl border px-3 py-1 ${
            event.is_athanor_day ? 'border-aura-line bg-aura-soft' : 'border-hair bg-background'
          }`}
        >
          <Text className={`text-[12px] ${event.is_athanor_day ? 'text-aura' : 'text-faint'}`}>
            {chip}
          </Text>
        </View>
        <Text className="text-2xl font-bold text-foreground">{event.title}</Text>
      </View>
    </View>
  );
}
