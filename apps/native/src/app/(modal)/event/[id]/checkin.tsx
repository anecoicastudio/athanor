import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocalSearchParams } from 'expo-router';
import { ActivityIndicator, AppState, Linking } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  checkInScan,
  eventKeys,
  getEvent,
  getEventCheckinCount,
  subscribeAttendance,
} from '@athanor/api';
import { galleria } from '@athanor/config';
import { t } from '@athanor/i18n';
import { Pressable, Text, View } from '@/tw';
import { EmptyState } from '@/components/EmptyState';
import { ModalHeader } from '@/components/ModalHeader';
import { useLocale } from '@/hooks/use-locale';
import { useAnnounceOnMount } from '@/lib/a11y';
import { devWarn } from '@/lib/log';
import { supabase } from '@/lib/supabase';
import { useGuardedBack } from '@/lib/modal-exit';
import { type Verdict, verdictText } from '@/lib/ticket-verdict';
import { Screen } from '@/components/Screen';

export default function CheckinScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const leave = useGuardedBack();
  const locale = useLocale();

  const qc = useQueryClient();
  const [permission, requestPermission, readPermission] = useCameraPermissions();
  // The camera is asked for on arrival, by the OS, with no screen of ours in front of it (#908,
  // Marco's ruling 2026-10-01). This screen used to open on a gate of its own — «Consenti la
  // fotocamera» and a back link that left without the system request ever being made — which is
  // the shape App Review rejected under Guideline 5.1.1(iv) (submission `4cb70b1c`). Opening the
  // scanner IS the request for the camera, so the dialog needs no introduction. Once per visit:
  // a first «Don't allow» on Android leaves the permission askable, and re-asking from an effect
  // would loop.
  const asked = useRef(false);
  // The arrival ask has come back, whatever it came back with. Until then the screen shows a
  // spinner under the OS dialog; after it, a status that is STILL not granted gets the gate —
  // including `undetermined`, which would otherwise spin with nothing to press. Two ways to get
  // there: a request that threw, and on web a dismissed browser prompt (`handleGetUserMediaError`
  // in expo-camera 57.0.6's `ExpoCameraManager.web.ts`, read 2026-10-01, maps «Permission
  // dismissed» to UNDETERMINED).
  const [answered, setAnswered] = useState(false);
  const askable = permission != null && !permission.granted && permission.canAskAgain;
  useEffect(() => {
    if (!askable || asked.current) return;
    asked.current = true;
    requestPermission()
      .catch((e: unknown) => devWarn('[checkin] camera request', e))
      .finally(() => setAnswered(true));
  }, [askable, requestPermission]);
  // Back from Settings with the camera on: read again, never prompt (same shape as MediaSheet's
  // re-peek, #749). Only while there is a refusal on screen to correct.
  const refused = permission != null && !permission.granted;
  useEffect(() => {
    if (!refused) return;
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void readPermission();
    });
    return () => sub.remove();
  }, [refused, readPermission]);
  const [last, setLast] = useState<{ v: Verdict; name?: string } | null>(null);
  // Lock so the continuous camera stream submits one token at a time + a short cooldown after a result.
  const busy = useRef(false);

  const event = useQuery({
    queryKey: eventKeys.detail(id),
    queryFn: () => getEvent(supabase, id),
    enabled: !!id,
  });

  // Seed the counter then subscribe to live INSERTs (cleanup on unmount — api.md #1).
  const seed = useQuery({
    queryKey: eventKeys.checkin(id),
    queryFn: () => getEventCheckinCount(supabase, id),
    enabled: !!id,
  });
  // The stream bumps the CACHED count, not a local mirror of it. The seed read and the live
  // INSERTs used to be two sources for one number, reconciled by a `setState` in an effect
  // (#691); now there is one source and the subscription writes to it.
  useEffect(() => {
    if (!id) return;
    const off = subscribeAttendance(supabase, id, () =>
      qc.setQueryData(eventKeys.checkin(id), (c: number | undefined) => (c ?? 0) + 1),
    );
    return off;
  }, [id, qc]);
  const count = seed.data ?? 0;

  // The verdict is a transient sentence with no other surface: it appears in a pill for 2s and is
  // gone (#635). Announce it — on iOS nothing else would, and the scanner's whole output is this
  // one line. `last` goes verdict → null → verdict between scans, so a repeat re-announces.
  useAnnounceOnMount(last ? verdictText(last.v, last.name, locale) : undefined);

  const onScan = useCallback(
    async (token: string) => {
      if (busy.current || !id) return;
      busy.current = true;
      try {
        const res = await checkInScan(supabase, id, token);
        setLast({ v: res.result, name: res.name });
        // counter is driven by the realtime INSERT; no optimistic bump here to avoid double-count.
      } catch (e) {
        devWarn('[checkin] scan request failed', e);
        setLast({ v: 'error' }); // transport failure ≠ invalid ticket — say "retry", not "invalid"
      } finally {
        // cooldown so the same QR in-frame isn't re-submitted ~10×/sec.
        setTimeout(() => {
          busy.current = false;
          setLast(null);
        }, 2000);
      }
    },
    [id],
  );

  // Not read yet, or the OS dialog is up over this screen: nothing of ours to say.
  if (!permission || (askable && !answered)) {
    return (
      <Screen className="items-center justify-center">
        <ActivityIndicator color={galleria.aura} />
      </Screen>
    );
  }

  // Only AFTER a refusal. Blocked → Settings is the one place left to turn it on; still askable
  // (Android, after one explicit «Don't allow») → the retry fires the OS dialog again.
  if (!permission.granted) {
    return (
      <Screen className="items-center justify-center gap-5 pl-8 pr-8">
        <EmptyState>{t('ticket.scan.permission', locale)}</EmptyState>
        <Pressable
          className="rounded-full bg-aura px-6 py-3"
          onPress={() =>
            permission.canAskAgain ? void requestPermission() : void Linking.openSettings()
          }
          accessibilityRole="button"
        >
          <Text className="text-[14px] text-on-aura">
            {t(permission.canAskAgain ? 'common.retry' : 'permission.openSettings', locale)}
          </Text>
        </Pressable>
        <Pressable onPress={leave} hitSlop={8}>
          <Text className="text-[13px] text-faint">{t('common.back', locale)}</Text>
        </Pressable>
      </Screen>
    );
  }

  const flash =
    last?.v === 'valid'
      ? 'border-success'
      : last && last.v !== 'already'
        ? 'border-error'
        : 'border-aura-line';

  return (
    <Screen>
      <CameraView
        style={{ flex: 1 }}
        facing="back"
        barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
        onBarcodeScanned={({ data }) => void onScan(data)}
      />
      {/* Header overlay */}
      <View className="absolute left-0 right-0 top-0">
        <ModalHeader
          title={t('ticket.scan.title', locale, { event: event.data?.title ?? '' })}
          backLabel={t('common.back', locale)}
          right={
            <Text className="text-[13px] text-aura">
              {t('ticket.scan.counter', locale, { n: count })}
            </Text>
          }
        />
      </View>
      {/* Reticle */}
      <View
        className="absolute inset-0 items-center justify-center"
        style={{ pointerEvents: 'none' }}
      >
        <View className={`h-56 w-56 rounded-card border-2 ${flash}`} />
        {!last ? (
          <Text className="mt-4 text-[13px] text-ink-2">{t('ticket.scan.hint', locale)}</Text>
        ) : null}
      </View>
      {/* Per-scan verdict */}
      {last ? (
        <View className="absolute bottom-16 left-5 right-5 rounded-card border border-hair bg-raise p-4">
          <Text className="text-center text-[15px] text-foreground">
            {verdictText(last.v, last.name, locale)}
          </Text>
        </View>
      ) : null}
    </Screen>
  );
}
