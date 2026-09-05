import { useMemo } from 'react';
import { createRevealOnFocus, type RevealOnFocus } from '@/lib/reveal-on-focus';

/**
 * The one focus-reveal recipe (#689): a form field that can end up under the keyboard is
 * scrolled into view when it is tapped. Companion to `KeyboardAvoiding`, which uncovers the
 * viewport but moves nothing inside it.
 *
 * Wire it three ways on the screen and nowhere else:
 *
 * ```tsx
 * const reveal = useRevealOnFocus();
 * <KeyboardAvoiding><Screen>
 *   <ScrollView {...reveal.scrollProps} className="flex-1" …>
 *     <View className="gap-2" ref={reveal.rowRef('password')}>
 *       <Text>…label…</Text>
 *       <Input … {...reveal.fieldProps('password')} />
 *       …hint, checklist…
 *     </View>
 * ```
 *
 * The ref goes on the ROW, not on the field: what has to end up visible is the label, the field
 * and whatever hangs off it. Row and field take the same key — mismatched keys is the one way to
 * wire this and get silence, so `lib/source-audit.test.ts` §36 pins the two sets equal.
 *
 * Everything the arithmetic does lives in `lib/reveal-on-focus.ts`, where a node-environment
 * test can reach it; this is the React half, and there is nothing else to it. The controller is
 * built once per screen — a new one per render would forget which field is focused.
 */
export function useRevealOnFocus(): RevealOnFocus {
  return useMemo(createRevealOnFocus, []);
}
