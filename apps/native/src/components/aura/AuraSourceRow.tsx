import { Text, View } from '@/tw';
import { ProgressBar } from '@/components/ProgressBar';

/**
 * One scored-bucket row in the Aura breakdown (spec §3.1).
 * label (ink-2) + optional progress bar + signed "+{value}" (tabular-nums, aura).
 * showBar defaults to true; pass showBar={false} for recap metric rows.
 */
export function AuraSourceRow({
  label,
  value,
  width,
  showBar = true,
}: {
  label: string;
  value: number;
  width: number;
  showBar?: boolean;
}) {
  const sign = value > 0 ? '+' : '';
  return (
    <View className="flex-row items-center gap-3 py-1">
      <Text className="flex-1 text-[13px] text-ink-2">{label}</Text>
      {showBar ? <ProgressBar width={width} className="w-24" /> : null}
      <Text
        className="min-w-[36px] text-right text-[13px] font-semibold text-aura"
        style={{ fontVariant: ['tabular-nums'] }}
      >
        {sign}
        {value}
      </Text>
    </View>
  );
}
