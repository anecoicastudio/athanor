import { t, type MessageKey } from '@athanor/i18n';
import type { AuraEventType, Locale } from '@athanor/schemas';
import { Text, View, cn } from '@/tw';
import { Row } from '@/components/Row';
import { timeAgo } from '@/lib/time';

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
 * One row of the Aura ledger (spec §3.2; Galleria, 2026-10-09, #921): the event's glyph, what
 * happened, how long ago, and the signed points at the right in the middle numeral style.
 *
 * The ledger pages, so a row draws its own SEGMENT of its day's group (`first` / `last`:
 * rounded ends, a hairline above all but the first), as `feed/Comment` does, and the list sets
 * no gap between rows.
 *
 * Points are foreground; a decay is grey, as the canvas draws it. Nothing here is cyan (a
 * ledger line is not the member's Aura numeral, DESIGN §2.3) and nothing is red: an upheld
 * report is a fact with a minus sign, not an error state. The sign is typed for both
 * directions, the minus as U+2212.
 *
 * The row is inert and is read out as ONE line, «what, when, points»: the glyph is an ornament
 * and says nothing. Until that day it was spoken by an English word typed in this file
 * («identity», «event»), in both languages.
 */
export function LedgerRow({
  type,
  points,
  createdAt,
  locale,
  first,
  last,
}: {
  type: AuraEventType;
  points: number;
  createdAt: string;
  locale: Locale;
  /** The first row of its day: the group's rounded top, no hairline above. */
  first: boolean;
  /** The last row of its day: the group's rounded foot. */
  last: boolean;
}) {
  const sign = points > 0 ? '+' : points < 0 ? '−' : '';
  const figure = `${sign}${Math.abs(points)}`;
  const title = t(LEDGER_TITLE[type], locale);
  const when = timeAgo(createdAt, locale);

  return (
    <View
      className={cn(
        'bg-surface px-4',
        first ? 'rounded-t-[28px]' : null,
        last ? 'rounded-b-[28px]' : null,
      )}
    >
      {first ? null : <View className="h-px bg-hair" />}
      <View accessible accessibilityLabel={[title, when, figure].join(', ')}>
        <Row
          leading={
            <View className="min-w-6 items-center">
              <Text className="type-body text-foreground">{LEDGER_GLYPH[type]}</Text>
            </View>
          }
          title={title}
          description={when}
          trailing={
            <Text
              className={cn(
                'type-num-m',
                type === 'decay' ? 'text-muted-foreground' : 'text-foreground',
              )}
              style={{ fontVariant: ['tabular-nums'] }}
            >
              {figure}
            </Text>
          }
        />
      </View>
    </View>
  );
}
