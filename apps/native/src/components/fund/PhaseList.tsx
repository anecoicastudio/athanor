import type { FundPhase } from '@athanor/schemas';
import { OPEN_CYCLE_PHASES } from '@athanor/core';
import { t } from '@athanor/i18n';
import { Text, View } from '@/tw';
import { FONT_SCALE_CAP } from '@/lib/type-scale';

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
        {/* `ornament` (#639): a step counter in a hard 21pt disc. Growing it would take the
            circle to an ellipse — height by the line box, width by the advance — and the
            number only restates the row's own position; the phase title and description
            beside it carry the meaning, and the row reads all three as one string. */}
        <Text
          className={`text-xs font-bold ${active ? 'text-background' : 'text-muted-foreground'}`}
          maxFontSizeMultiplier={FONT_SCALE_CAP.ornament}
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
 * Ordered list of the open-cycle phases (candidacy → screening → voting → announcement →
 * realization; `closed` has no row — a closed cycle is not rendered as a step).
 * The row matching `current` is highlighted in cyan + carries the «in corso» chip.
 *
 * The list comes from `OPEN_CYCLE_PHASES` (`@athanor/core`), which derives from the zod enum —
 * this file used to carry a fourth copy of the phase vocabulary (#382), so a phase added to the
 * cycle silently went unrendered here.
 */
export function PhaseList({ current, locale }: { current: FundPhase; locale: 'it' | 'en' }) {
  return (
    <View className="gap-0">
      {OPEN_CYCLE_PHASES.map((key, i) => (
        <PhaseRow key={key} index={i + 1} phaseKey={key} active={key === current} locale={locale} />
      ))}
    </View>
  );
}
