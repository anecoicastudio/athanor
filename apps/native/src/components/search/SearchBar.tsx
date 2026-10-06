import { useState } from 'react';
import { Pressable, TextInput, View, cn } from '@/tw';
import { CloseIcon } from '@/components/glyphs';
import { galleria } from '@athanor/config';
import { PRESS_DIM } from '@/lib/press';

/**
 * Controlled search input (M8 §3.3 / §4 `<SearchBar>`).
 *
 * Debouncing is the SCREEN's responsibility — this component is purely
 * controlled and fires `onChangeText` on every keystroke. The clear control
 * shows only when `value` is non-empty; tap calls `onClear`.
 *
 * The field is `Input`'s pill (DESIGN §9 Input, Galleria here since 2026-10-06, #921): at least
 * 50pt, a `surface` fill, 17px text, 20 at the left, and a 1px border that is transparent at
 * rest and foreground on focus, so focus does not move the text. It is not `Input` itself
 * because the clear control comes and goes with the value, and `Input`'s `trailing` is a
 * static shape (its docblock).
 *
 * The clear control is the drawn close (18, secondary grey) in a 44pt box, 4 inside the
 * pill's round end. It is ALWAYS MOUNTED: while the field is empty it is transparent,
 * disabled and hidden from assistive tech. Mounted on the first character instead, it cost
 * keystrokes. On the iPhone SE simulator (iOS 26.3, Expo Go, 2026-10-06), «cera» typed by
 * `idb ui text` into a freshly opened screen arrived as «c» twice, «cra» twice and whole four
 * times in eight tries; kept mounted, whole in five of five, as the bar before that day was
 * in four of four. Why a sibling's mount drops a character was not established.
 * It also keeps the field one width, so the text does not move
 * when the control shows.
 *
 * The prototype's search field has no leading glyph and neither has this one since that day:
 * the screen is the search, and the drawn back stands beside the field.
 *
 * Tokens only — no literal hex (hook enforced). The one exception is
 * `placeholderTextColor` which RN requires a raw color value; we pull it
 * from the `galleria` tokens in `@athanor/config`.
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
      className={cn(
        'min-h-[50px] flex-row items-center rounded-full border bg-surface pl-5 pr-1',
        focused ? 'border-foreground' : 'border-transparent',
      )}
    >
      {/* Controlled text input. 17px without `type-body`: a one-line field sets its text low
          under that class's 24pt line (`Input`'s docblock). Vertical padding is physical. */}
      <TextInput
        className="flex-1 pb-3 pr-4 pt-3 text-[17px] text-foreground"
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={galleria.foregroundMuted}
        autoCorrect={false}
        autoCapitalize="none"
        returnKeyType="search"
        accessibilityRole="search"
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
      />

      {/* Clear: a 44pt box, named by its label. Always mounted and hidden while the field is
          empty, see the docblock. */}
      <Pressable
        className={cn(
          'min-h-[44px] min-w-[44px] items-center justify-center',
          PRESS_DIM,
          !hasClearButton && 'opacity-0',
        )}
        onPress={onClear}
        disabled={!hasClearButton}
        accessibilityRole="button"
        accessibilityLabel={clearAccessibilityLabel}
        accessibilityElementsHidden={!hasClearButton}
        importantForAccessibility={hasClearButton ? 'auto' : 'no-hide-descendants'}
      >
        <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          <CloseIcon size={18} color={galleria.foregroundMuted} />
        </View>
      </Pressable>
    </View>
  );
}
