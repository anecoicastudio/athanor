import { Pressable, Text, View } from '@/tw';

type Segment = 'requests' | 'connections';

/**
 * Two-segment toggle for the Connessioni hub (Richieste | Connessioni). The active
 * segment uses a flat cyan accent chip (rule #4 — fill is fine, no glow); inactive
 * reads as faint text on a hairline pill.
 */
export function SegmentedToggle({
  value,
  onChange,
  labels,
}: {
  value: Segment;
  onChange: (value: Segment) => void;
  labels: { requests: string; connections: string };
}) {
  const segments: Segment[] = ['requests', 'connections'];
  return (
    <View className="flex-row gap-2 rounded-full border border-hair bg-raise p-1">
      {segments.map((segment) => {
        const active = value === segment;
        return (
          <Pressable
            key={segment}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            className={`flex-1 items-center justify-center rounded-full px-4 py-2 min-h-[44px] ${active ? 'bg-aura' : ''}`}
            onPress={() => onChange(segment)}
          >
            <Text className={`text-[14px] font-semibold ${active ? 'text-on-aura' : 'text-faint'}`}>
              {labels[segment]}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
