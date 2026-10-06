import { Text, View } from '@/tw';
import { t } from '@athanor/i18n';
import type { Locale, Notification } from '@athanor/schemas';
import { Row } from '@/components/Row';
import { Tag } from '@/components/Tag';
import { displayParams } from '@/lib/notif-params';
import { timeAgo } from '@/lib/time';
import { FONT_SCALE_CAP } from '@/lib/type-scale';
import { NOTIF_GLYPH, NOTIF_LEAD, NOTIF_LEAD_BY_TEMPLATE } from './notifTypes';

/**
 * One notification (M9 §4): a `Row` of the «Nuove» or the «Prima» group since 2026-10-06
 * (#921, as the prototype draws it):
 *  - leading: the type's glyph in a 30pt disc (hairline, `surface`). The row of a WAITING
 *    Momento, unread and of type `moment`, leads with the 8px cyan dot instead: the first of
 *    the five marks (DESIGN §2.3). Read, it takes the ✦ disc like any other row.
 *  - title: the lead (`notif.type.*`, or a per-template override)
 *  - second line, grey: the tail (interpolated `notif.tpl.*` template) · relative time
 *  - «Apri Momento» on a Momento's row: a `Tag`, because the row is the control
 *  - no chevron, and no unread dot: the group a row stands in says whether it was read, and
 *    never a number (rule #3)
 *
 * Ruled by Marco that day: cyan only on the waiting dot; the confirmed-help row (#637) and
 * the action chip are no longer cyan.
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
  const waiting = item.type === 'moment' && item.read_at == null;
  // Template first, then type: a template can mean something its type does not (#637).
  const lead = t(NOTIF_LEAD_BY_TEMPLATE[item.template_key] ?? NOTIF_LEAD[item.type], locale);
  // Template tail: interpolate `{name}`, `{count}`, `{title}`, `{amount}` etc. from params.
  // template_key is schema-validated (unknown keys degrade to notif.tpl.generic — #113).
  // displayParams localizes the warn template's `reason` token (#313); every other
  // template's params pass through untouched.
  const tail = t(item.template_key, locale, displayParams(item, locale));

  return (
    <Row
      leading={
        waiting ? (
          <View className="h-2 w-2 rounded-full bg-aura" />
        ) : (
          <View className="h-[30px] w-[30px] items-center justify-center rounded-full border border-hair bg-surface">
            {/* `ornament` (#639): the disc stays a disc — height and width would grow by the
                glyph's line box and its advance, which are different numbers. The row's own
                accessibilityLabel carries the meaning, so the glyph reads nothing. */}
            <Text
              className="text-[12px] font-semibold text-foreground"
              maxFontSizeMultiplier={FONT_SCALE_CAP.ornament}
            >
              {NOTIF_GLYPH[item.type]}
            </Text>
          </View>
        )
      }
      title={lead}
      description={`${tail} · ${timeAgo(item.created_at, locale)}`}
      trailing={
        item.type === 'moment' ? <Tag label={t('notif.action.openMoment', locale)} /> : undefined
      }
      showChevron={false}
      onPress={() => onPress(item)}
      accessibilityLabel={`${lead}. ${tail}`}
    />
  );
}
