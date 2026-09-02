import { Text, View } from '@/tw';
import { auraGlow } from '@/lib/glow';
import { FONT_SCALE_CAP } from '@/lib/type-scale';

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
      {/* The one place a numeral is capped tighter than the app default (#639): four cells
          divide the row with `flex-1`, so the cell cannot widen for a bigger digit pair and
          «00» would leave it. `display` still lands ~35pt — larger than 2x-scaled body. */}
      <Text
        className={`text-3xl font-extrabold ${accent ? 'text-aura' : 'text-foreground'}`}
        maxFontSizeMultiplier={FONT_SCALE_CAP.display}
        style={{ fontVariant: ['tabular-nums'] }}
      >
        {padded}
      </Text>
      <Text className="mt-1 text-[11px] text-muted-foreground">{unitLabel}</Text>
    </View>
  );
}
