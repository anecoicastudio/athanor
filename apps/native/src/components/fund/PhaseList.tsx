import type { FundPhase } from '@athanor/schemas';
import { t } from '@athanor/i18n';
import { Text, View } from '@/tw';

const PHASES: FundPhase[] = ['community', 'reputation', 'ethics', 'event'];

/** One numbered phase row. Highlighted when `active`. */
function PhaseRow({
  index,
  phaseKey,
  active,
  locale,
}: {
  index: number;
  phaseKey: FundPhase;
  active: boolean;
  locale: 'it' | 'en';
}) {
  const title = t(`fund.phase.${phaseKey}.t` as Parameters<typeof t>[0], locale);
  const desc = t(`fund.phase.${phaseKey}.d` as Parameters<typeof t>[0], locale);
  const currentLabel = t('fund.phase.current', locale);

  return (
    <View
      className={`flex-row gap-3 py-3 ${active ? 'border-l-2 border-aura pl-3' : 'pl-[14px]'}`}
      accessibilityRole="text"
    >
      {/* Number badge */}
      <View
        className={`h-6 w-6 items-center justify-center rounded-full ${
          active ? 'bg-aura' : 'bg-raise'
        }`}
      >
        <Text
          className={`text-xs font-bold ${active ? 'text-background' : 'text-muted-foreground'}`}
        >
          {index}
        </Text>
      </View>

      {/* Title + desc + optional «in corso» chip */}
      <View className="flex-1 gap-0.5">
        <View className="flex-row items-center gap-2">
          <Text className={`text-sm font-semibold ${active ? 'text-aura' : 'text-foreground'}`}>
            {title}
          </Text>
          {active && (
            <View className="rounded-full border border-aura-line bg-aura-soft px-2 py-0.5">
              <Text className="text-[10px] font-medium text-aura">{currentLabel}</Text>
            </View>
          )}
        </View>
        <Text className="text-xs text-muted-foreground">{desc}</Text>
      </View>
    </View>
  );
}

/**
 * Ordered list of the 4 selection phases (community → reputation → ethics → event).
 * The row matching `current` is highlighted in cyan + carries the «in corso» chip.
 */
export function PhaseList({ current, locale }: { current: FundPhase; locale: 'it' | 'en' }) {
  return (
    <View className="gap-0">
      {PHASES.map((key, i) => (
        <PhaseRow key={key} index={i + 1} phaseKey={key} active={key === current} locale={locale} />
      ))}
    </View>
  );
}
