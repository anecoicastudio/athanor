import { Pressable, Text, View } from '@/tw';
import { t, type MessageKey } from '@athanor/i18n';
import type { Locale, Notification } from '@athanor/schemas';
import { timeAgo } from '@/lib/time';
import { NOTIF_VISUAL, NOTIF_LEAD } from './notifTypes';

/**
 * One notification row (M9 §4). Composed of:
 *  - ndot: accent circle (cyan for `moment`, neutral for all others — rule #4) + Unicode glyph
 *  - body: bolded lead (`notif.type.*`) + tail (interpolated `notif.tpl.*` template)
 *  - relative time stamp
 *  - optional «Apri Momento» action chip (moment type only)
 *  - unread presence dot (`read_at == null`) — never a number (rule #3)
 *
 * No glow on this surface (rule #4). The `moment` accent is a flat `aura-soft` fill — not a glow.
 */
export default function NotificationRow({
  item,
  locale,
  onPress,
}: {
  item: Notification;
  locale: Locale;
  onPress: (n: Notification) => void;
}) {
  const v = NOTIF_VISUAL[item.type];
  const unread = item.read_at == null;
  const lead = t(NOTIF_LEAD[item.type] as MessageKey, locale);
  // Template tail: interpolate `{name}`, `{count}`, `{title}`, `{amount}` etc. from params.
  // params values are `unknown`; cast to Record<string,string|number> for t().
  const tail = t(
    item.template_key as MessageKey,
    locale,
    item.params as Record<string, string | number>,
  );

  return (
    <Pressable
      onPress={() => onPress(item)}
      accessibilityRole="button"
      accessibilityLabel={`${lead}. ${tail}`}
      className="flex-row items-start gap-3 px-5 py-3"
    >
      {/* ndot: accent circle + glyph */}
      <View className={`mt-0.5 h-9 w-9 items-center justify-center rounded-full ${v.accentClass}`}>
        <Text className={`text-base ${v.celebratory ? 'text-aura' : 'text-faint'}`}>{v.glyph}</Text>
      </View>

      {/* Body */}
      <View className="flex-1 gap-1">
        <Text className="text-[14px] leading-snug text-foreground">
          <Text className="font-semibold">{lead}</Text>
          {'  '}
          {tail}
        </Text>

        <Text className="text-[12px] text-muted-foreground">
          {timeAgo(item.created_at, locale)}
        </Text>

        {/* Action chip: moment only → «Apri Momento» */}
        {item.type === 'moment' ? (
          <View className="mt-1 self-start rounded-full border border-aura-line bg-aura-soft px-3 py-1">
            <Text className="text-[12px] text-aura">{t('notif.action.openMoment', locale)}</Text>
          </View>
        ) : null}
      </View>

      {/* Unread presence dot — never a number (rule #3) */}
      {unread ? <View className="mt-3 h-2 w-2 flex-shrink-0 rounded-full bg-aura" /> : null}
    </Pressable>
  );
}
