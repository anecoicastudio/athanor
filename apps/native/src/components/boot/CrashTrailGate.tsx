import { useEffect } from 'react';
import { AppState } from 'react-native';
import { describeTrail, endedCleanly, markStep, readPreviousTrail } from '@/lib/crash-trail';
import { devWarn } from '@/lib/log';

/**
 * Reads back the durable step trail the previous run left, and keeps this run's trail honest
 * about how it ends (#452). Renders nothing.
 *
 * Two jobs:
 *
 *  1. **Surface the previous run.** If it stopped where it stood — no `app.background` last — say
 *     so in the Metro console. That is the developer-facing half; the tester-facing half is
 *     `SentryConsentGate`, which sends the same trail once Sentry is up and consent is granted.
 *  2. **Mark the app lifecycle.** `app.background` is what tells an ordinary OS reclaim apart
 *     from a crash: a force-quit from the app switcher always emits it first, a jetsam kill or a
 *     native crash never does. Both markers are rare, which is what makes them affordable — each
 *     one is a durable write.
 *
 * A Metro/Expo Go reload restarts the JS context with no background transition, so in dev the
 * previous run will usually read as unclean. That is the mechanism working, not a finding.
 */
export function CrashTrailGate() {
  useEffect(() => {
    let mounted = true;

    void (async () => {
      const previous = await readPreviousTrail();
      if (!mounted) return;
      if (previous && !endedCleanly(previous)) {
        devWarn('[crash-trail] previous session did not exit cleanly', describeTrail(previous));
      }
      await markStep('boot.ready');
    })();

    // Not awaited, and cannot be — the listener is synchronous. Unlike the media markers there is
    // no native call here to get in front of; the write only has to beat suspension, and iOS
    // leaves seconds of runway after `didEnterBackground` for a write that takes milliseconds.
    // These are the only two markers allowed to be fired and forgotten (#488): the
    // `crash-trail:void-ok` marker is what makes them pass `source-audit.test.ts` §13, and the
    // reason is registered there by name, so dropping the exemption is as loud as adding one.
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'background') {
        void markStep('app.background'); // crash-trail:void-ok
      } else if (state === 'active') {
        void markStep('app.active'); // crash-trail:void-ok
      }
    });

    return () => {
      mounted = false;
      sub.remove();
    };
  }, []);

  return null;
}
