import { Pressable, Text, View } from '@/tw';
import { t, type MessageKey } from '@athanor/i18n';
import type { Locale, StarKey } from '@athanor/schemas';
import { STAR, starGlyph, type StarCellState } from '@/lib/star';

/**
 * One cell of the Six Stars grid.
 * - earned → filled ✦ (`text-aura`) with `bg-aura-soft` + `border-aura-line` inset.
 * - own-unearned → outline ✧ (`text-faint`) + plain `bg-raise`, tappable.
 * - own-unknown → em dash (`text-faint`) + plain `bg-raise`, NOT tappable (issue #16).
 * - other's unearned → `null` (hidden — rule #3: no vanity "what they're missing").
 *
 * `unknown` is the read having failed, not a state the member is in. It is a third SHAPE, not
 * a dimmer colour: DESIGN §11 (2026-08-08) put state in the glyph and rejected an `inert` token
 * for splitting `faint`, so `—` — the mark the app already uses for every unknown value — is
 * what says «we don't know» here. It is deliberately not pressable: the detail sheet behind an
 * unknown cell would show criteria and a progress bar for a star whose progress we could not
 * read, which is the same false claim one tap deeper.
 *
 * A non-owner never reaches the unknown branch — `SixStarsGrid` renders a single placeholder
 * for the whole grid instead. Six unknown cells on someone else's profile would render MORE
 * cells than a real profile with two lit stars, turning a failed read into a visible shape
 * difference and asserting «we don't know» six times about a person.
 */
export function StarCell({
  starId,
  state,
  viewerIsOwner,
  locale,
  onPress,
}: {
  starId: StarKey;
  state: StarCellState;
  viewerIsOwner: boolean;
  locale: Locale;
  onPress?: () => void;
}) {
  const name = t(`star.${starId}` as MessageKey, locale);
  const stateWord = t(
    state === 'lit' ? 'star.lit' : state === 'unlit' ? 'star.unlit' : 'star.unknown',
    locale,
  );

  // Others' unearned stars are hidden (rule #3); others' unknown never gets here.
  if (state !== 'lit' && !viewerIsOwner) return null;

  // `accessible` + hidden descendants on both non-pressable branches: a bare RN View is NOT an
  // accessibility element just because it carries a role and a label, so VoiceOver would walk
  // past the composed «{name}, {state}» and read the children instead. For `unknown` that means
  // announcing an em dash as punctuation and never saying the state at all — the exact thing
  // `aura-display.ts` keeps a spoken key around to prevent. `Pressable` (the unlit branch) is
  // accessible by default, which is why only these two need it.
  if (state === 'lit') {
    return (
      <View
        className="w-1/3 items-center gap-1.5 py-3"
        accessible={true}
        accessibilityRole="image"
        accessibilityLabel={`${name}, ${stateWord}`}
      >
        <View
          className="items-center justify-center rounded-full border border-aura-line bg-aura-soft p-2"
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          <Text className="text-2xl text-aura">{starGlyph(state)}</Text>
        </View>
        <Text className="text-[11px] tracking-wide text-aura">{name}</Text>
      </View>
    );
  }

  // own-unknown: same frame as unearned so the grid does not reflow, but inert — there is
  // nothing to open and nothing to claim.
  if (state === 'unknown') {
    return (
      <View
        className="w-1/3 items-center gap-1.5 py-3"
        accessible={true}
        accessibilityRole="image"
        accessibilityLabel={`${name}, ${stateWord}`}
      >
        <View
          className="items-center justify-center rounded-full bg-raise p-2"
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          <Text className="text-2xl text-faint">{starGlyph(state)}</Text>
        </View>
        <Text className="text-[11px] tracking-wide text-faint">{name}</Text>
      </View>
    );
  }

  // own-unearned: tappable
  return (
    <Pressable
      className="w-1/3 items-center gap-1.5 py-3"
      accessibilityRole="button"
      accessibilityLabel={`${name}, ${stateWord}`}
      onPress={onPress}
    >
      <View className="items-center justify-center rounded-full bg-raise p-2">
        <Text className="text-2xl text-faint">{STAR.unlit}</Text>
      </View>
      <Text className="text-[11px] tracking-wide text-faint">{name}</Text>
    </Pressable>
  );
}
