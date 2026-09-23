import React, { createContext, useContext } from 'react';
import { useWindowDimensions } from 'react-native';

/**
 * The member's live text size, read ONCE at the root and handed down (#754).
 *
 * A Dynamic Type change made while the app runs re-renders every Text at the new size but
 * keeps the OLD layout: nothing on the JS side changed, so the shadow tree reuses the
 * measurements taken at the previous scale — rows sized for it, lines clipped or gapped.
 * The `src/tw` `Text` wrapper keys itself on this value, and a remounted Text is measured
 * from scratch, which dirties every box above it. Stateless leaves are the only safe thing
 * to remount: a key on the navigator or on `Screen` would throw away navigation state and
 * every unsaved draft (they live in component state), and `TextInput` is deliberately left
 * unkeyed for the same reason — a remount drops focus and resets `defaultValue` fields.
 *
 * Context rather than `useWindowDimensions()` in every Text: one Dimensions listener, not
 * hundreds, and the provider's value is the bare number, so a rotation or a keyboard does
 * not re-render the tree — only a text-size change does. Outside the provider (a test, a
 * tree mounted above it) the value is 1, which keys nothing differently.
 */
const FontScaleContext = createContext(1);

export function FontScaleProvider({ children }: { children: React.ReactNode }) {
  const { fontScale } = useWindowDimensions();
  return <FontScaleContext.Provider value={fontScale}>{children}</FontScaleContext.Provider>;
}

export const useFontScale = () => useContext(FontScaleContext);
