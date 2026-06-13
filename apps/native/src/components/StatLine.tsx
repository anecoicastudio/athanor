import { Text, View } from '@/tw';

export function StatLine({ items }: { items: { value: string; label: string }[] }) {
  return (
    <View className="flex-row border-y border-hair py-4">
      {items.map((it) => (
        <View key={it.label} className="flex-1 items-center gap-1">
          <Text className="text-lg font-semibold text-foreground">{it.value}</Text>
          <Text className="text-[12px] text-faint">{it.label}</Text>
        </View>
      ))}
    </View>
  );
}
