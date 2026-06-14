import { Pressable, Text, View } from '@/tw';

/**
 * Settings list row (DESIGN.md §8 list-row): title + optional description on the
 * left; optional right value text + chevron. The whole row is one accessible
 * button. `danger` tints the title for destructive actions (Esci). No icon set
 * exists yet (Foundation glyphs deferred) — rows are text-led.
 */
export function SettingsRow({
  title,
  description,
  value,
  onPress,
  danger = false,
  showChevron = true,
  accessibilityLabel,
}: {
  title: string;
  description?: string;
  value?: string;
  onPress?: () => void;
  danger?: boolean;
  showChevron?: boolean;
  accessibilityLabel?: string;
}) {
  return (
    <Pressable
      className="min-h-[56px] flex-row items-center justify-between gap-4 px-5 py-4"
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? title}
    >
      <View className="flex-1 gap-1">
        <Text className={`text-base ${danger ? 'text-error' : 'text-foreground'}`}>{title}</Text>
        {description ? <Text className="text-[13px] text-faint">{description}</Text> : null}
      </View>
      <View className="flex-row items-center gap-2">
        {value ? <Text className="text-sm text-muted-foreground">{value}</Text> : null}
        {showChevron && onPress ? <Text className="text-base text-faint">›</Text> : null}
      </View>
    </Pressable>
  );
}
