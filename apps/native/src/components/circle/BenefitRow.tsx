import { t } from '@athanor/i18n';
import type { Locale } from '@athanor/schemas';
import { Text, View } from '@/tw';
import { Tag } from '@/components/Tag';

/**
 * One benefit row for the Circle paywall surface (M8 §3.2).
 * Leading check glyph ✓ tinted `aura` when unlocked, `faint` when locked — mirrors
 * the MilestoneRow.tsx pattern (done ? '✓' : '○', text-aura : text-faint).
 * Trailing `Tag` «in arrivo» when `soon` (cosmetic, no interaction) — `quiet`, so its label is
 * `muted-foreground`, matching `desc` below.
 *
 * A locked title is `faint`, i.e. dimmer than both the Tag and its own `desc`. That is NOT the
 * metadata-outranks-payload inversion the quiet tone exists to fix: here `faint` marks STATE
 * (locked), the same way MilestoneRow dims a done row, not rank. Raising it to `ink-2` would
 * buy a tidier ladder by spending the locked signal. Left as is, deliberately.
 *
 * Min-height ≥44pt for touch accessibility.
 */
export function BenefitRow({
  title,
  desc,
  unlocked,
  soon = false,
  locale,
}: {
  title: string;
  desc: string;
  unlocked: boolean;
  soon?: boolean;
  locale: Locale;
}) {
  return (
    <View className="min-h-[44px] flex-row items-start gap-3 py-1">
      {/* Check glyph — aura when unlocked, faint when locked (MilestoneRow pattern) */}
      <Text
        className={`pt-0.5 text-base ${unlocked ? 'text-aura' : 'text-faint'}`}
        accessibilityLabel={unlocked ? t('common.done', locale) : t('common.locked', locale)}
      >
        {unlocked ? '✓' : '○'}
      </Text>

      {/* Content */}
      <View className="flex-1 gap-0.5">
        <View className="flex-row items-center gap-2">
          <Text
            className={`flex-1 text-[15px] font-semibold ${unlocked ? 'text-foreground' : 'text-faint'}`}
          >
            {title}
          </Text>
          {soon ? <Tag quiet label={t('circle.benefit.soon', locale)} /> : null}
        </View>
        <Text className="text-[13px] leading-5 text-muted-foreground">{desc}</Text>
      </View>
    </View>
  );
}
