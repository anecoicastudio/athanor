import { useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Device from 'expo-device';
import { PermissionPrimer } from '@/components/media/PermissionPrimer';
import { useLocale } from '@/hooks/use-locale';
import { useAuth } from '@/lib/auth-context';
import { devWarn } from '@/lib/log';
import type { PermStatus } from '@/lib/media/permission-status';
import { ensurePushPermission, peekPushPermission } from '@/lib/push';

/**
 * One-time pre-permission primer for notifications (#561). push.ts used to fire the OS
 * dialog cold from auth-context on every signed-in boot until a grant existed — the fourth
 * canAskAgain-blind site, and the only one with no priming at all: it burned the one iOS ask
 * with zero context. The ask now happens here, primed, and at most once per install:
 * `athanor.push.primed` is written on any resolution (allow-path settled, or «Più tardi»),
 * mirroring the OS's own one-shot iOS semantics, so a member who said no is not re-asked at
 * every boot. A member who grants later in Settings needs no primer — `registerForPush` is
 * read-only on the permission now and registers silently on the next boot / token refresh.
 *
 * Mounted in `(tabs)/_layout`: only a signed-in, complete profile ever sees it (auth and the
 * funnel sit outside the tabs group), and `Device.isDevice` gates the whole effect — the
 * simulator and expo-web have no push token to ask for, so the primer is NOT REACHABLE on
 * the expo-web QA surface by design.
 *
 * State machine = MediaSheet's primer flow: the peek seeds `undetermined` (a `blocked` peek
 * with no member action is not a moment to nag about Settings, and `granted` needs nothing);
 * «Attiva» runs `ensurePushPermission` — the one real OS prompt; `blocked` keeps the primer
 * up swapped to the Settings deep-link; `denied` (Android, still askable) keeps the normal
 * copy for a retry or a dismiss. Registration goes through auth-context's `registerPush` so
 * the token lands in the same ref signOut unregisters.
 */
const PRIMED_KEY = 'athanor.push.primed';

export function PushPrimer() {
  const locale = useLocale();
  const { registerPush } = useAuth();
  const [status, setStatus] = useState<PermStatus | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        if (!Device.isDevice) return;
        if ((await AsyncStorage.getItem(PRIMED_KEY)) != null) return;
        const peeked = await peekPushPermission();
        if (!cancelled && peeked === 'undetermined') setStatus('undetermined');
      } catch (e) {
        devWarn('[push] primer peek', e); // best-effort: no primer, boot continues
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const markPrimed = () => {
    // Best-effort: an unwritable flag re-shows the primer next boot, nothing breaks.
    AsyncStorage.setItem(PRIMED_KEY, '1').catch((e: unknown) => devWarn('[push] primer flag', e));
  };

  const allow = async () => {
    try {
      const next = await ensurePushPermission();
      if (next === 'granted') {
        markPrimed();
        setStatus(null);
        void registerPush();
        return;
      }
      // `blocked` swaps the primer to the Settings CTA; `denied` (the OS can still ask)
      // keeps the normal copy. Both close via «Più tardi», which writes the flag.
      setStatus(next);
    } catch (e) {
      devWarn('[push] primer allow', e);
      markPrimed();
      setStatus(null); // fail closed — never a dead primer over the app
    }
  };

  if (status == null) return null;
  return (
    <PermissionPrimer
      kind="push"
      status={status}
      visible
      locale={locale}
      onAllow={() => void allow()}
      onDismiss={() => {
        markPrimed();
        setStatus(null);
      }}
    />
  );
}
