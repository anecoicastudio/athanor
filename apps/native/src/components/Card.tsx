import { createContext, useContext, type ReactNode } from 'react';
import { View } from '@/tw';

const InsideCard = createContext(false);

/**
 * True under a `Card`. A text field reads it: the field's own fill is the card's (`surface`),
 * so inside a card it would show nothing but its text at rest. There it takes the stage colour
 * instead and reads as a well cut into the block (#921, 2026-10-04).
 */
export const useInsideCard = () => useContext(InsideCard);

/**
 * The bordered card (DESIGN §9): `surface`, radius 28, padding 20, a hairline. A screen has at
 * most one, for the thing that matters (§2.4); a list is grouped rows, not a stack of cards.
 */
export function Card({ children }: { children: ReactNode }) {
  return (
    <InsideCard.Provider value={true}>
      <View className="gap-[14px] rounded-[28px] border border-hair bg-surface p-5">
        {children}
      </View>
    </InsideCard.Provider>
  );
}
