import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ActivityIndicator } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useQuery } from '@tanstack/react-query';
import {
  checkInScan,
  eventKeys,
  getEvent,
  getEventCheckinCount,
  subscribeAttendance,
} from '@athanor/api';
import { semantic } from '@athanor/config';
import { t } from '@athanor/i18n';
import type { CheckInResult } from '@athanor/schemas';
import { Pressable, Text, View } from '@/tw';
import { EmptyState } from '@/components/EmptyState';
import { useAuth } from '@/lib/auth-context';
import { supabase } from '@/lib/supabase';

type Verdict = CheckInResult['result'];

function verdictText(v: Verdict, name: string | undefined, locale: 'it' | 'en'): string {
  switch (v) {
    case 'valid':
      return t('ticket.scan.welcome', locale, { name: name ?? t('ticket.scan.someone', locale) });
    case 'already':
      return t('ticket.scan.already', locale);
    case 'wrongEvent':
      return t('ticket.scan.wrongEvent', locale);
    default:
      return t('ticket.scan.invalid', locale);
  }
}

export default function CheckinScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { profile } = useAuth();
  const router = useRouter();
  const locale = profile?.locale ?? 'it';

  const [permission, requestPermission] = useCameraPermissions();
  const [count, setCount] = useState(0);
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
  useEffect(() => {
    if (seed.data != null) setCount(seed.data);
  }, [seed.data]);
  useEffect(() => {
    if (!id) return;
    const off = subscribeAttendance(supabase, id, () => setCount((c) => c + 1));
    return off;
  }, [id]);

  const onScan = useCallback(
    async (token: string) => {
      if (busy.current || !id) return;
      busy.current = true;
      try {
        const res = await checkInScan(supabase, id, token);
        setLast({ v: res.result, name: res.name });
        // counter is driven by the realtime INSERT; no optimistic bump here to avoid double-count.
      } catch {
        setLast({ v: 'invalid' });
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

  if (!permission) {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <ActivityIndicator color={semantic.aura} />
      </View>
    );
  }

  if (!permission.granted) {
    return (
      <View className="flex-1 items-center justify-center gap-5 bg-background px-8">
        <EmptyState>{t('ticket.scan.permission', locale)}</EmptyState>
        <Pressable
          className="rounded-ctl bg-aura px-6 py-3"
          onPress={() => void requestPermission()}
          accessibilityRole="button"
        >
          <Text className="text-[14px] text-on-aura">{t('ticket.scan.allow', locale)}</Text>
        </Pressable>
        <Pressable onPress={() => router.back()} hitSlop={8}>
          <Text className="text-[13px] text-faint">{t('common.back', locale)}</Text>
        </Pressable>
      </View>
    );
  }

  const flash =
    last?.v === 'valid'
      ? 'border-success'
      : last && last.v !== 'already'
        ? 'border-error'
        : 'border-aura-line';

  return (
    <View className="flex-1 bg-background">
      <CameraView
        style={{ flex: 1 }}
        facing="back"
        barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
        onBarcodeScanned={({ data }) => void onScan(data)}
      />
      {/* Header overlay */}
      <View className="absolute left-0 right-0 top-0 flex-row items-center gap-3 px-5 pt-14">
        <Pressable
          onPress={() => router.back()}
          hitSlop={8}
          accessibilityLabel={t('common.back', locale)}
        >
          <Text className="text-[22px] text-foreground">‹</Text>
        </Pressable>
        <Text className="flex-1 text-[16px] text-foreground">
          {t('ticket.scan.title', locale, { event: event.data?.title ?? '' })}
        </Text>
        <Text className="text-[13px] text-aura">
          {t('ticket.scan.counter', locale, { n: count })}
        </Text>
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
    </View>
  );
}
