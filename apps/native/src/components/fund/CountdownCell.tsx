import { Text, View } from '@/tw';
import { auraGlow } from '@/lib/glow';

/** One countdown cell — big tabular-nums value + unit label. `accent` lights the `sec` cell cyan (rule #4 sec glow). */
export function CountdownCell({
  value,
  unitLabel,
  accent = false,
}: {
  value: number;
  unitLabel: string;
  accent?: boolean;
}) {
  const padded = value < 10 ? `0${value}` : String(value);
  return (
    <View
      className={`flex-1 items-center rounded-card py-3 ${
        accent ? 'border border-aura-line bg-aura-soft' : 'bg-raise'
      }`}
      style={accent ? auraGlow(1) : undefined}
    >
      <Text
        className={`text-3xl font-extrabold ${accent ? 'text-aura' : 'text-foreground'}`}
        style={{ fontVariant: ['tabular-nums'] }}
      >
        {padded}
      </Text>
      <Text className="mt-1 text-[11px] text-muted-foreground">{unitLabel}</Text>
    </View>
  );
}
