import { t } from '@athanor/i18n';
import type { Locale } from '@athanor/schemas';
import { Pressable, Text, View } from '@/tw';

export type PricePlan = 'monthly' | 'annual';

/**
 * Two-segment price toggle (M8 §3.1): monthly | annual.
 * Active segment uses foreground-fill chip (not cyan — rule #4; a pricing toggle
 * is not a moment-grade event). Mirrors SegmentedToggle.tsx shape but with typed
 * 'monthly'|'annual' values and i18n labels from circle.plan.* keys.
 */
export function PriceToggle({
  value,
  onChange,
  locale,
}: {
  value: PricePlan;
  onChange: (value: PricePlan) => void;
  locale: Locale;
}) {
  const plans: PricePlan[] = ['monthly', 'annual'];
  return (
    <View className="flex-row gap-2 rounded-full border border-hair bg-raise p-1">
      {plans.map((plan) => {
        const active = value === plan;
        return (
          <Pressable
            key={plan}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            className={`flex-1 items-center justify-center rounded-full px-4 py-2 min-h-[44px] ${active ? 'bg-foreground' : ''}`}
            onPress={() => onChange(plan)}
          >
            <Text
              className={`text-[14px] font-semibold ${active ? 'text-background' : 'text-faint'}`}
            >
              {t(`circle.plan.${plan}`, locale)}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
