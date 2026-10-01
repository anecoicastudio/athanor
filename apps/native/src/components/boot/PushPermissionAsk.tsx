import { useEffect, useRef } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Device from 'expo-device';
import { useAuth } from '@/lib/auth-context';
import { devWarn } from '@/lib/log';
import { ensurePushPermission, peekPushPermission } from '@/lib/push';

/**
 * The one notification-permission ask per install (#561), with no UI of its own.
 *
 * Until #908 this was `PushPrimer`, a sheet shown before the OS dialog with «Attiva» and «Più
 * tardi». App Review rejected that shape under Guideline 5.1.1(iv) (submission `4cb70b1c`,
 * 2026-10-01): a custom message before a permission request may not be dismissible short of the
 * request. Marco's ruling the same day drops the sheet everywhere rather than rewording it, so
 * this now fires the OS dialog directly and renders nothing.
 *
 * What #561 fixed still holds, because it was never the sheet that fixed it: the ask happens at
 * most ONCE per install, not on every signed-in boot. `athanor.push.primed` is written on any
 * answer, mirroring iOS's own one-shot semantics — the key keeps its old name so an install that
 * already answered the primer is not asked a second time by an update. A member who said no
 * turns notifications on from the preferences screen, whose switch is `ensurePushPermission`'s
 * other caller (#637), or in Settings: `registerForPush` is read-only on the permission and
 * registers silently on the next boot / token refresh.
 *
 * Mounted in `(tabs)/_layout`: only a signed-in, complete profile ever reaches it (auth and the
 * funnel sit outside the tabs group), so the dialog arrives once the person is inside the app
 * rather than over sign-in. `Device.isDevice` gates the whole effect — the simulator and expo-web
 * have no push token to ask for, so the ask is NOT REACHABLE on the expo-web QA surface by design.
 * Only an `undetermined` peek asks: `granted` needs nothing, and a `blocked` peek with no member
 * action is not a moment to send anybody to Settings.
 *
 * Registration goes through auth-context's `registerPush` so the token lands in the same ref
 * signOut unregisters.
 */
const ASKED_KEY = 'athanor.push.primed';

export function PushPermissionAsk() {
  const { registerPush } = useAuth();
  // One ask per mount, whatever re-runs the effect: a second `requestPermissionsAsync` queued
  // behind an open dialog is the cold double-ask #561 removed.
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void (async () => {
      try {
        if (!Device.isDevice) return;
        if ((await AsyncStorage.getItem(ASKED_KEY)) != null) return;
        if ((await peekPushPermission()) !== 'undetermined') return;
        const answer = await ensurePushPermission();
        // Best-effort: an unwritable flag asks again next boot while the OS still can, nothing
        // breaks.
        AsyncStorage.setItem(ASKED_KEY, '1').catch((e: unknown) => devWarn('[push] ask flag', e));
        if (answer === 'granted') void registerPush();
      } catch (e) {
        devWarn('[push] ask', e); // best-effort: no ask, boot continues
      }
    })();
  }, [registerPush]);

  return null;
}
