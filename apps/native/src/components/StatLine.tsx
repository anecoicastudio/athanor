import { Text, View } from '@/tw';

/**
 * A row of figures under their labels (DESIGN §4: `numeral-m` over `label`). The value is a
 * digit string: `type-num-m` has a line height equal to its size, which cuts the accent of a
 * capital on iOS, so a word does not belong here.
 */
export function StatLine({ items }: { items: { value: string; label: string }[] }) {
  return (
    <View className="flex-row border-y border-hair py-4">
      {items.map((it) => (
        <View key={it.label} className="flex-1 items-center gap-1">
          <Text className="type-num-m text-foreground">{it.value}</Text>
          <Text className="text-center type-label text-muted-foreground">{it.label}</Text>
        </View>
      ))}
    </View>
  );
}
