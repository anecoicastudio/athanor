import { View } from '@/tw';
import { Chip } from '@/components/Chip';

type Segment = 'requests' | 'connections';

const SEGMENTS: Segment[] = ['requests', 'connections'];

/**
 * The two segments of the Connessioni hub (Richieste | Connessioni), as two chips 8 apart
 * (DESIGN §8.13, §9 «Chip»; #921): the selected one is the foreground chip, the other a
 * hairline one. No cyan: choosing a list is not one of the five marks.
 *
 * A chip is as wide as its word and the row wraps, so no label is ever cut. The half-pill
 * segments this replaced gave each label half the width and one line with an ellipsis (#847).
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
  return (
    <View className="flex-row flex-wrap gap-2">
      {SEGMENTS.map((segment) => (
        <Chip
          key={segment}
          label={labels[segment]}
          selected={value === segment}
          onPress={() => onChange(segment)}
        />
      ))}
    </View>
  );
}
