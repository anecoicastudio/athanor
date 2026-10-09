import { Text, View } from '@/tw';
import { ProgressBar } from '@/components/ProgressBar';

/**
 * One scored bucket of the Aura breakdown (spec §3.1; Galleria, 2026-10-09, #921): a bare block
 * on the stage, the bucket's name with its figure at the right, and the bar under them.
 *
 * The figure is foreground (DESIGN §8.12: the cyan numeral on this screen is the member's own
 * Aura, and a bucket is a part of it, not a second one) and carries no sign: it is a subtotal,
 * not a change. The block is read out as one line, «name, figure».
 * The Aura screen is the one caller. The week recap rendered this without its bar until
 * 2026-10-07, when it took grouped rows of its own.
 */
export function AuraSourceRow({
  label,
  value,
  width,
}: {
  label: string;
  value: number;
  width: number;
}) {
  return (
    <View className="gap-1" accessible accessibilityLabel={[label, String(value)].join(', ')}>
      <View className="flex-row items-baseline justify-between gap-3">
        <Text className="flex-1 type-body text-foreground">{label}</Text>
        <Text className="type-small text-foreground" style={{ fontVariant: ['tabular-nums'] }}>
          {value}
        </Text>
      </View>
      <ProgressBar width={width} />
    </View>
  );
}
