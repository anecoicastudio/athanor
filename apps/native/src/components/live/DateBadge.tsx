import { t } from '@athanor/i18n';
import { Text, View } from '@/tw';

const MONTHS_IT = [
  'Gen',
  'Feb',
  'Mar',
  'Apr',
  'Mag',
  'Giu',
  'Lug',
  'Ago',
  'Set',
  'Ott',
  'Nov',
  'Dic',
];
const MONTHS_EN = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

/**
 * The square date chip on every EventRow. `highlight` (Athanor Day) → auraSoft fill +
 * aura day number. `live` → a static cyan «●» (no day/month) — reduced-motion safe; the
 * pulsing animation lives on the row's Chip live, per frontend 04 §9.
 */
export function DateBadge({
  iso,
  locale,
  highlight = false,
  live = false,
}: {
  iso: string;
  locale: 'it' | 'en';
  highlight?: boolean;
  live?: boolean;
}) {
  if (live) {
    return (
      <View
        className="min-h-12 min-w-12 items-center justify-center rounded-ctl border border-aura-line bg-aura-soft p-1"
        accessibilityLabel={t('live.chip.liveNow', locale)}
      >
        <Text className="text-[18px] text-aura">●</Text>
      </View>
    );
  }
  const d = new Date(iso);
  const months = locale === 'it' ? MONTHS_IT : MONTHS_EN;
  return (
    <View
      // `min-h`/`min-w` (#639): two lines of text — day number over month — in a hard
      // square is the shape that clips first. Same painted size at the default text size,
      // so every EventRow reads exactly as it does today.
      className={`min-h-12 min-w-12 items-center justify-center rounded-ctl border p-1 ${
        highlight ? 'border-aura-line bg-aura-soft' : 'border-hair bg-raise'
      }`}
    >
      <Text className={`text-[17px] font-semibold ${highlight ? 'text-aura' : 'text-foreground'}`}>
        {d.getDate()}
      </Text>
      {/* Tone follows `highlight` like the day number above, and for a contrast reason, not
          symmetry: in the dark world `faint` was 4.17:1 on this badge when highlighted, and
          `muted-foreground` 5.72. INTERIM (#921, open as of 2026-10-03): the two are one grey
          now — 3.85:1 on `bg-aura-soft` over EventRow's `bg-raise` (= #1E2F31), 4.65 on plain
          raise. `lib/contrast.test.ts` names this badge. */}
      <Text
        className={`text-[10px] uppercase ${highlight ? 'text-muted-foreground' : 'text-faint'}`}
      >
        {months[d.getMonth()]}
      </Text>
    </View>
  );
}
