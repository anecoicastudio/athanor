import { Text, View } from '@/tw';

/** Static read-mode tag — a fact, not a control. Quiet hairline pill. */
export function Tag({ label }: { label: string }) {
  return (
    <View className="rounded-full border border-hair bg-raise-2 px-4 py-1.5">
      <Text className="text-[13px] text-foreground">{label}</Text>
    </View>
  );
}
