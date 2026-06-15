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
        className="h-12 w-12 items-center justify-center rounded-ctl border border-aura-line bg-aura-soft"
        accessibilityLabel="In diretta"
      >
        <Text className="text-[18px] text-aura">●</Text>
      </View>
    );
  }
  const d = new Date(iso);
  const months = locale === 'it' ? MONTHS_IT : MONTHS_EN;
  return (
    <View
      className={`h-12 w-12 items-center justify-center rounded-ctl border ${
        highlight ? 'border-aura-line bg-aura-soft' : 'border-hair bg-raise'
      }`}
    >
      <Text className={`text-[17px] font-semibold ${highlight ? 'text-aura' : 'text-foreground'}`}>
        {d.getDate()}
      </Text>
      <Text className="text-[10px] uppercase text-faint">{months[d.getMonth()]}</Text>
    </View>
  );
}
