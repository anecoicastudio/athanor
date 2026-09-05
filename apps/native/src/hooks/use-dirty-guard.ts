import { useCallback } from 'react';
import { Alert, Platform } from 'react-native';
import { usePreventRemove } from 'expo-router/react-navigation';
import { useNavigation } from 'expo-router';
import { type Locale, t } from '@athanor/i18n';
import { useLocale } from '@/hooks/use-locale';
import { shouldGuardExit } from '@/lib/dirty-guard';

/**
 * The one discard confirm, so every composer asks the same question in the same words —
 * DESIGN.md §8.13's «one block, one confirm, everywhere», applied to leaving a draft.
 */
function askToDiscard(locale: Locale, onDiscard: () => void): void {
  Alert.alert(t('draft.discard.title', locale), t('draft.discard.body', locale), [
    { text: t('draft.discard.keep', locale), style: 'cancel' },
    { text: t('draft.discard.leave', locale), style: 'destructive', onPress: onDiscard },
  ]);
}

/**
 * One confirm between a member's unsaved draft and every way out of a composer (#636).
 *
 * ## Why `usePreventRemove` and not a `beforeRemove` listener
 *
 * Not a style preference — the listener cannot do this job. `@react-navigation/native-stack`
 * reads the prevent-remove CONTEXT, not the event, and passes `preventNativeDismiss` down to
 * the native screen from it (`NativeStackView.native.tsx`, `isRemovePrevented`). Only
 * `usePreventRemove` populates that context. A `navigation.addListener('beforeRemove', …)`
 * leaves `preventNativeDismiss` false, so on iOS the sheet is dismissed NATIVELY and the JS
 * listener runs with the screen already gone — react-navigation's own docs say `preventDefault`
 * "may not work correctly" on native-stack for exactly this reason. Most of the roster is
 * `presentation: 'modal'` (`src/app/(modal)/_layout.tsx`), so the swipe-down IS the gesture
 * this guard exists to catch and the listener form would have guarded nothing that matters
 * while looking correct. `progress.tsx` is the exception — it declares no `<Stack.Screen>`, so
 * it presents as a push card whose gesture is the iOS left-edge back-swipe, and
 * `ProfileEditForm` is not a route at all (see `useDiscardConfirm` below).
 *
 * `@react-navigation/native` is a direct dependency for this reason: `expo-router@6` does not
 * re-export the hook (`build/exports.d.ts`), and the transitive copy under `node_modules/.pnpm`
 * is not reachable by a bare import.
 *
 * ## What it covers, in one call
 *
 * `ModalHeader` already routes its chevron through `useGuardedBack`, and both a pop and the
 * `dismissTo` fallback are navigation-state changes, so intercepting removal catches the header
 * chevron, the Android hardware back button, the iOS sheet swipe-down and the left-edge
 * back-swipe together. A screen adds this hook and needs no change at any exit site — which is
 * also why the guard cannot be forgotten at one exit while covering the others.
 *
 * ## What it deliberately does NOT cover
 *
 * Nested `Modal`-based sheets (`MediaSheet`, `MessageActionsSheet`) are not navigator screens,
 * so removal never fires for them; they are not composers and hold no draft. And on
 * react-native-web the guard stands down entirely — see `shouldGuardExit`.
 *
 * No sibling unit test: this file imports `@react-navigation/native` and `react-native`, and
 * `vitest.config.ts` runs `environment: 'node'`, where react-native's untranspiled Flow cannot
 * be collected. The decision it defers to is pure and tested in `src/lib/dirty-guard.test.ts`;
 * source-audit §31 pins the wiring so this cannot go vacuous.
 */
export function useDirtyGuard({
  dirty,
  saving = false,
  submitted = false,
}: {
  /** `isDraftDirty(baseline, current)` — see `src/lib/dirty-guard.ts`. */
  dirty: boolean;
  /** A write is in flight. */
  saving?: boolean;
  /** The write landed and the screen is leaving under its own power. */
  submitted?: boolean;
}): void {
  const navigation = useNavigation();
  const locale = useLocale();

  usePreventRemove(
    shouldGuardExit({ dirty, saving, submitted, platformOS: Platform.OS }),
    ({ data }) => {
      // Re-dispatch the action we blocked, so the member lands where they were going — the
      // header chevron's `dismissTo` fallback included, not just a plain pop.
      askToDiscard(locale, () => navigation.dispatch(data.action));
    },
  );
}

/**
 * The same confirm, for an exit that is not a navigation event (#636).
 *
 * `usePreventRemove` can only see a screen being REMOVED. The profile editor is not a screen:
 * it is an `editing` flag inside the persistent Profilo tab, and its only ways out are its own
 * «Annulla» controls — the one at its foot, and since #659 a second at its head — so nothing
 * is popped and nothing fires. Without this it would be the one surface on the roster the guard
 * could not reach, and it holds the largest form in the app.
 *
 * Returns a caller that runs `onDiscard` immediately when there is nothing to protect, so the
 * call site stays a single unconditional line and cannot forget the clean-draft branch. The
 * web stand-down of `shouldGuardExit` applies here for the same reason it does there: an
 * `Alert` that renders nothing would turn «Annulla» into a dead button.
 */
export function useDiscardConfirm(): (
  state: { dirty: boolean; saving?: boolean; submitted?: boolean },
  onDiscard: () => void,
) => void {
  const locale = useLocale();
  return useCallback(
    ({ dirty, saving = false, submitted = false }, onDiscard) => {
      if (!shouldGuardExit({ dirty, saving, submitted, platformOS: Platform.OS })) {
        onDiscard();
        return;
      }
      askToDiscard(locale, onDiscard);
    },
    [locale],
  );
}
