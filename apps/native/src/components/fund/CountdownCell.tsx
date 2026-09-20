import { Text, View } from '@/tw';
import { FONT_SCALE_CAP } from '@/lib/type-scale';

/**
 * One countdown cell — big tabular-nums value + unit label. `accent` lights the `sec` cell cyan.
 *
 * No glow here, deliberately: DESIGN.md §8.12 gives `/annual` exactly one glow and it is the
 * live fund ticker's («numbers flat `aura` — no glow on the clock»). This cell shipped with
 * `auraGlow(1)` against that, which on Android also bled an elevation rectangle through the
 * translucent fill. What `accent` takes instead is the framed pair `border-aura-line
 * bg-aura-soft` — the ordinary active surface, not a glow (§11, ruled 2026-09-07).
 *
 * Every cell carries a 1px border so the row reads as one object: colour alone marks the live
 * one. The quiet cells were borderless before, which made the accent cell look heavy rather
 * than lit.
 */
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
      className={`flex-1 items-center rounded-card border py-3 ${
        accent ? 'border-aura-line bg-aura-soft' : 'border-hair bg-raise'
      }`}
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
