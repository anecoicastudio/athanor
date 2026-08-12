import React from 'react';
import { useCssElement } from 'react-native-css';
import { SafeAreaView } from 'react-native-safe-area-context';
import { cn } from '@/tw';

/**
 * Screen root — owns the top safe-area inset (#161), so no screen hardcodes a
 * `pt-14`/`pt-16` guess at the status bar again.
 *
 * Built on the native SafeAreaView from react-native-safe-area-context rather
 * than `useSafeAreaInsets`: the native view measures the inset per VIEW, not
 * per window, so one component is correct everywhere without a presentation
 * prop — 0 inside an iOS sheet (the sheet already cleared the status bar),
 * status-bar height on a full-screen push and on Android modals (edge-to-edge),
 * and correct again on a sheet-over-sheet push (`messages` → `chat`). A prop
 * would have to mirror `(modal)/_layout.tsx` per screen and drift.
 *
 * `gutter` adds the DESIGN.md §6 20pt horizontal screen padding
 * (`spacing.gutter` / `--spacing-gutter`) for screens whose content doesn't
 * carry its own `px-*` on an inner container.
 */
export type ScreenProps = React.ComponentProps<typeof SafeAreaView> & {
  className?: string;
  /** 20pt horizontal screen padding (DESIGN.md §6). Off by default: most screens pad an inner container. */
  gutter?: boolean;
};

// Erased generic, same idiom as src/tw: exact public props, widened impl for useCssElement.
const SafeAreaViewImpl = SafeAreaView as unknown as React.ComponentType<Record<string, unknown>>;

export function Screen({ className, gutter, ...rest }: ScreenProps) {
  return useCssElement(
    SafeAreaViewImpl,
    {
      edges: ['top'],
      ...rest,
      className: cn('flex-1 bg-background', gutter && 'px-gutter', className),
    },
    { className: 'style' },
  );
}
Screen.displayName = 'CSS(Screen)';
