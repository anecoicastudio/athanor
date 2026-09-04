import { Pressable, Text, View } from '@/tw';
import { t } from '@athanor/i18n';
import type { Locale, Notification } from '@athanor/schemas';
import { displayParams } from '@/lib/notif-params';
import { timeAgo } from '@/lib/time';
import { FONT_SCALE_CAP } from '@/lib/type-scale';
import {
  NOTIF_VISUAL,
  NOTIF_VISUAL_BY_TEMPLATE,
  NOTIF_LEAD,
  NOTIF_LEAD_BY_TEMPLATE,
} from './notifTypes';

/**
 * One notification row (M9 §4). Composed of:
 *  - ndot: accent circle (cyan for `moment` and for the `helpConfirmed` template, neutral for
 *    everything else — rule #4) + Unicode glyph
 *  - body: bolded lead (`notif.type.*`, or a per-template override) + tail (interpolated
 *    `notif.tpl.*` template)
 *  - relative time stamp
 *  - optional «Apri Momento» action chip (moment type only)
 *  - unread presence dot (`read_at == null`) — never a number (rule #3)
 *
 * No glow on this surface (rule #4). Both celebratory accents are a flat `aura-soft` fill —
 * not a glow.
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
  // Template first, then type — the same precedence the lead uses, and for the same reason:
  // a template can mean something its type does not (#637).
  const v = NOTIF_VISUAL_BY_TEMPLATE[item.template_key] ?? NOTIF_VISUAL[item.type];
  const unread = item.read_at == null;
  const lead = t(NOTIF_LEAD_BY_TEMPLATE[item.template_key] ?? NOTIF_LEAD[item.type], locale);
  // Template tail: interpolate `{name}`, `{count}`, `{title}`, `{amount}` etc. from params.
  // template_key is schema-validated (unknown keys degrade to notif.tpl.generic — #113).
  // displayParams localizes the warn template's `reason` token (#313); every other
  // template's params pass through untouched.
  const tail = t(item.template_key, locale, displayParams(item, locale));

  return (
    <Pressable
      onPress={() => onPress(item)}
      accessibilityRole="button"
      accessibilityLabel={`${lead}. ${tail}`}
      className="flex-row items-start gap-3 px-5 py-3"
    >
      {/* ndot: accent circle + glyph */}
      <View className={`mt-0.5 h-9 w-9 items-center justify-center rounded-full ${v.accentClass}`}>
        {/* `ornament` (#639): the disc stays a disc — height and width would grow by the
            glyph's line box and its advance, which are different numbers. The row's own
            accessibilityLabel above carries the meaning, so the glyph reads nothing. */}
        <Text
          className={`text-base ${v.celebratory ? 'text-aura' : 'text-faint'}`}
          maxFontSizeMultiplier={FONT_SCALE_CAP.ornament}
        >
          {v.glyph}
        </Text>
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
