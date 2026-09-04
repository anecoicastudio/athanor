import React from 'react';
import { useCssElement } from 'react-native-css';
import { SafeAreaView } from 'react-native-safe-area-context';
import { View, cn } from '@/tw';
import { SuspendedNotice } from '@/components/SuspendedNotice';
import { ToastViewport } from '@/components/ToastHost';

/**
 * Screen root — owns the top safe-area inset (#161) AND the bottom one (#163),
 * so no screen hardcodes a `pt-14`/`pt-16` guess at the status bar or reserves
 * `pb-[104px]` for chrome that is not on screen again.
 *
 * Built on the native SafeAreaView from react-native-safe-area-context rather
 * than `useSafeAreaInsets`: the native view measures the inset per VIEW, not
 * per window, so one component is correct everywhere without a presentation
 * prop — 0 inside an iOS sheet (the sheet already cleared the status bar),
 * status-bar height on a full-screen push and on Android modals (edge-to-edge),
 * and correct again on a sheet-over-sheet push (`messages` → `chat`). A prop
 * would have to mirror `(modal)/_layout.tsx` per screen and drift.
 *
 * The bottom edge rides the same measurement: home-indicator height on sheets
 * (a composer bar never sits on the indicator), 0 on tab screens (the tab bar
 * is a flow sibling below this view and already carries its own inset), and 0
 * while the keyboard-avoiding wrapper has lifted this view off the window
 * bottom. Trailing breathing room stays in scroll content as `pb-12` — the one
 * shared value (#163) — because container padding cannot scroll.
 *
 * That last clause has an exception, and it is INSIDE A SHEET — which is every
 * `(modal)/*` route, since the group itself carries `presentation: 'modal'`.
 * `SafeAreaView`'s Fabric implementation walks the NATIVE superview chain for a
 * provider and falls back to measuring itself when it finds none, and a presented
 * modal has none: react-native-screens reparents modal views out of the RN root
 * tree. In that fallback the keyboard observers and the `RNCSafeAreaDidChange`
 * broadcast that would refresh the inset both belong to the provider, so neither
 * reaches this view. The bottom inset inside a sheet therefore stays at its
 * home-indicator value while the keyboard is up instead of going to 0 — a ~34pt
 * over-reservation, not a hidden control, and not something this component can
 * fix from JS. Named here so the next reader does not spend a device round on it.
 *
 * `gutter` adds the DESIGN.md §6 20pt horizontal screen padding
 * (`spacing.gutter` / `--spacing-gutter`) for screens whose content doesn't
 * carry its own `px-*` on an inner container.
 *
 * Every Screen also mounts the global toast viewport (#117) — the pill's
 * `bottom-10` measures from the CONTENT region, which is the whole Screen
 * unless a `footer` is pinned. `footer` wraps the children in a flex-1 View
 * with the footer below it, so a persistent action bar sits above the bottom
 * inset and the toast band clears it by construction. In footer mode,
 * content-alignment classNames (`items-center` …) stop reaching the children —
 * they stay on the SafeAreaView; pad/align inside the footer-less content
 * instead. `toastInset` is the full-bleed escape hatch for chrome that overlays
 * the content and so cannot be a `footer` at all.
 */
export type ScreenProps = React.ComponentProps<typeof SafeAreaView> & {
  className?: string;
  /** 20pt horizontal screen padding (DESIGN.md §6). Off by default: most screens pad an inner container. */
  gutter?: boolean;
  /** Pinned action bar below the content region (#117). The toast band sits above it, not on it. */
  footer?: React.ReactNode;
  /**
   * Height of chrome that OVERLAYS the content instead of sitting below it, so the toast band
   * clears it the way `footer` does. Only a full-bleed screen needs this; prefer `footer`.
   */
  toastInset?: number;
};

// Erased generic, same idiom as src/tw: exact public props, widened impl for useCssElement.
const SafeAreaViewImpl = SafeAreaView as unknown as React.ComponentType<Record<string, unknown>>;

export function Screen({ className, gutter, footer, toastInset, children, ...rest }: ScreenProps) {
  const content = (
    <>
      {/* Sanction banner (#312) rides every Screen the way the toast viewport does,
        so a suspended member sees the state on the modal where a write fails, not
        only on the tab roots. Renders nothing in good standing. */}
      <SuspendedNotice />
      {children}
      <ToastViewport bottomInset={toastInset} />
    </>
  );
  return useCssElement(
    SafeAreaViewImpl,
    {
      edges: ['top', 'bottom'],
      ...rest,
      className: cn('flex-1 bg-background', gutter && 'px-gutter', className),
      children:
        footer == null ? (
          content
        ) : (
          <>
            <View className="flex-1">{content}</View>
            {footer}
          </>
        ),
    },
    { className: 'style' },
  );
}
Screen.displayName = 'CSS(Screen)';
