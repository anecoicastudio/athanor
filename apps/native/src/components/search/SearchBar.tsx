import { useState } from 'react';
import { Pressable, Text, TextInput, View } from '@/tw';
import { SearchIcon } from '@/components/glyphs';
import { semantic } from '@athanor/config';

/**
 * Controlled search input (M8 §3.3 / §4 `<SearchBar>`).
 *
 * Debouncing is the SCREEN's responsibility — this component is purely
 * controlled and fires `onChangeText` on every keystroke. Clear ×
 * appears only when `value` is non-empty; tap calls `onClear`.
 *
 * Pill shape + focus → `border-foreground` ring 1px (DESIGN §9 Input:
 * radius full, focus = foreground ring — not aura). Unfocused → `border-hair`.
 *
 * Tokens only — no literal hex (hook enforced). The one exception is
 * `placeholderTextColor` which RN requires a raw color value; we pull it
 * from `@athanor/config` semantic tokens.
 */
export function SearchBar({
  value,
  onChangeText,
  onClear,
  placeholder,
  clearAccessibilityLabel = 'Clear search',
}: {
  value: string;
  onChangeText: (text: string) => void;
  onClear: () => void;
  placeholder: string;
  clearAccessibilityLabel?: string;
}) {
  const [focused, setFocused] = useState(false);

  const hasClearButton = value.length > 0;

  return (
    <View
      className={`flex-row items-center gap-2 rounded-full border bg-raise px-3 ${
        focused ? 'border-foreground' : 'border-hair'
      }`}
    >
      {/* Search glyph — leading icon */}
      <View className="items-center justify-center" style={{ width: 22, height: 44 }}>
        <SearchIcon size={18} />
      </View>

      {/* Controlled text input */}
      <TextInput
        className="flex-1 text-[15px] text-foreground"
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={semantic.foregroundMuted}
        autoCorrect={false}
        autoCapitalize="none"
        returnKeyType="search"
        // `minHeight`, not `height` (#639): a fixed 44 clips the field's own text at AX
        // sizes. The floor stays 44 because this input is also its own tap target (§10).
        style={{ minHeight: 44 }}
        accessibilityRole="search"
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
      />

      {/* Clear × — visible only when value is non-empty; ≥44pt tap target */}
      {hasClearButton ? (
        <Pressable
          className="items-center justify-center"
          style={{ width: 44, height: 44 }}
          onPress={onClear}
          accessibilityRole="button"
          accessibilityLabel={clearAccessibilityLabel}
          hitSlop={8}
        >
          <View
            className="items-center justify-center rounded-full bg-raise-2"
            style={{ width: 20, height: 20 }}
          >
            <Text className="text-[13px] leading-none text-muted-foreground">×</Text>
          </View>
        </Pressable>
      ) : null}
    </View>
  );
}
