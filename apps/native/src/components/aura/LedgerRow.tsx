import { t, type MessageKey } from '@athanor/i18n';
import type { AuraEventType, Locale } from '@athanor/schemas';
import { Text, View } from '@/tw';
import { timeAgo } from '@/lib/time-ago';

/** Glyph representing each ledger event type (esoteric set). */
const LEDGER_GLYPH: Record<AuraEventType, string> = {
  identity_verified: '◈',
  event_attended: '◎',
  event_organized: '✦',
  momento_conversation: '◉',
  milestone_help: '⟡',
  own_milestone: '▲',
  post_starred: '✦',
  report_upheld: '⬡',
  decay: '◌',
};

/** A11y text equivalents for screen readers. */
const LEDGER_GLYPH_A11Y: Record<AuraEventType, string> = {
  identity_verified: 'identity',
  event_attended: 'event',
  event_organized: 'organized',
  momento_conversation: 'momento',
  milestone_help: 'help',
  own_milestone: 'milestone',
  post_starred: 'star',
  report_upheld: 'report',
  decay: 'decay',
};

/** Mapped i18n title keys (spec §3.2). */
const LEDGER_TITLE: Record<AuraEventType, MessageKey> = {
  identity_verified: 'ledger.type.identity',
  event_attended: 'ledger.type.eventAttend',
  event_organized: 'ledger.type.eventOrg',
  momento_conversation: 'ledger.type.momento',
  milestone_help: 'ledger.type.help',
  own_milestone: 'ledger.type.ownMilestone',
  post_starred: 'ledger.type.postStar',
  report_upheld: 'ledger.type.report',
  decay: 'ledger.type.decay',
};

/**
 * One row in the Aura ledger list (spec §3.2).
 * glyph + title + relative time + signed ±N points (tabular-nums).
 * Point colour: aura (>0), muted (decay), danger (<0 non-decay).
 */
export function LedgerRow({
  type,
  points,
  createdAt,
  locale,
}: {
  type: AuraEventType;
  points: number;
  createdAt: string;
  locale: Locale;
}) {
  const sign = points > 0 ? '+' : '';
  const tone = points > 0 ? 'text-aura' : type === 'decay' ? 'text-muted' : 'text-danger';

  return (
    <View className="flex-row items-center gap-3 py-2">
      <Text
        className="text-[18px] text-faint"
        accessibilityLabel={LEDGER_GLYPH_A11Y[type]}
        accessibilityElementsHidden={false}
      >
        {LEDGER_GLYPH[type]}
      </Text>
      <View className="flex-1 gap-0.5">
        <Text className="text-[14px] text-foreground">{t(LEDGER_TITLE[type], locale)}</Text>
        <Text className="text-[12px] text-faint">{timeAgo(createdAt, locale)}</Text>
      </View>
      <Text
        className={`text-[13px] font-semibold ${tone}`}
        style={{ fontVariant: ['tabular-nums'] }}
      >
        {sign}
        {points}
      </Text>
    </View>
  );
}
