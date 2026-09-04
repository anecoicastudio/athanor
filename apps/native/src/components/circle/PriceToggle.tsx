import { formatPrice } from '@athanor/core';
import { t } from '@athanor/i18n';
import type { CirclePlan, CirclePrices, Locale } from '@athanor/schemas';
import { Pressable, Text, View, cn } from '@/tw';

/**
 * Two-segment price toggle (M8 §3.1): monthly | annual, each segment carrying its own live
 * amount (#675).
 *
 * The segments used to carry only «Mensile» / «Annuale», so the two plans could never be seen
 * side by side — choosing meant flipping the toggle and remembering. Each segment now names
 * its plan AND its price, so the comparison is one glance. The amounts are the live ones
 * `get-circle-prices` serves (#644); until they arrive the segments show the names alone,
 * and the CTA slot below says why (spinner or retry).
 *
 * The numerals are `tabular-nums` with NO tracking (DESIGN §4: tracking belongs to pill
 * labels and `micro`, numerals get tabular figures) — run 12 of the 2026-09 review found the
 * decision-critical string rendered only inside the CTA's letterspaced label, which breaks
 * numeral grouping. The CTA keeps its §9 label; the comparison lives here.
 *
 * Active segment uses foreground-fill chip (not cyan — rule #4; a pricing toggle is not a
 * moment-grade event). Mirrors SegmentedToggle.tsx shape with typed plan values.
 *
 * Roles: the container is a `radiogroup` and each segment a `radio` — two exclusive options,
 * which VoiceOver then announces as «1 di 2» with `checked` (the pairing `Chip.tsx` documents,
 * #635). `plan` is the schemas enum, not a local copy (#674 item 4).
 */
export function PriceToggle({
  value,
  onChange,
  locale,
  prices,
}: {
  value: CirclePlan;
  onChange: (value: CirclePlan) => void;
  locale: Locale;
  /** Live amounts, or null while they load / after the read failed. */
  prices: CirclePrices | null;
}) {
  const plans: CirclePlan[] = ['monthly', 'annual'];
  return (
    <View
      className="flex-row gap-2 rounded-full border border-hair bg-raise p-1"
      accessibilityRole="radiogroup"
    >
      {plans.map((plan) => {
        const active = value === plan;
        const name = t(`circle.plan.${plan}`, locale);
        const priceLine = prices
          ? t(`circle.plan.${plan}.price`, locale, {
              price: formatPrice(prices[plan].unitAmount, prices[plan].currency, locale),
            })
          : null;
        return (
          <Pressable
            key={plan}
            accessibilityRole="radio"
            accessibilityState={{ checked: active, selected: active }}
            accessibilityLabel={priceLine ? `${name}, ${priceLine}` : name}
            className={cn(
              'flex-1 items-center justify-center rounded-full px-4 py-2 min-h-[44px]',
              active && 'bg-foreground',
            )}
            onPress={() => onChange(plan)}
          >
            <Text
              className={cn('text-[14px] font-semibold', active ? 'text-background' : 'text-faint')}
            >
              {name}
            </Text>
            {priceLine ? (
              <Text
                className={cn('text-[13px]', active ? 'text-background' : 'text-faint')}
                style={{ fontVariant: ['tabular-nums'] }}
              >
                {priceLine}
              </Text>
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}
