import { useCallback } from 'react';
import { Switch } from 'react-native';
import { useRouter } from 'expo-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { semantic } from '@athanor/config';
import { t, type MessageKey } from '@athanor/i18n';
import {
  notifKeys,
  getPreferences,
  setNotifPref,
  getPushEnabled,
  setPushEnabled,
} from '@athanor/api';
import type { NotifPrefInput } from '@athanor/schemas';
import { Pressable, ScrollView, Text, View } from '@/tw';
import { useAuth } from '@/lib/auth-context';
import { supabase } from '@/lib/supabase';

/**
 * Notification preferences (M9 §3.7). 6 per-type push toggles + master push toggle.
 * `connection` type has no opt-out toggle (always delivered, master-only gated — Decision #4).
 * Neutral chrome throughout — no glow (rule #4). Optimistic + silent (no toast host).
 * Absent pref row = enabled by default (Decision #1 master rule, 09 §2.5).
 * Zero hardcoded strings (rule #5).
 */

const PREF_ROWS: { key: string; type: NotifPrefInput['type'] }[] = [
  { key: 'notif.prefs.moment', type: 'moment' },
  { key: 'notif.prefs.dream', type: 'dreamMilestone' },
  { key: 'notif.prefs.review', type: 'review' },
  { key: 'notif.prefs.events', type: 'eventReminder' },
  { key: 'notif.prefs.fund', type: 'fundMilestone' },
  { key: 'notif.prefs.projects', type: 'projectResponse' },
];

export default function NotifPrefsScreen() {
  const router = useRouter();
  const { profile } = useAuth();
  const locale = profile?.locale ?? 'it';
  const qc = useQueryClient();

  // ── Per-type preferences ───────────────────────────────────────────────────
  const prefs = useQuery({
    queryKey: notifKeys.prefs(),
    queryFn: () => getPreferences(supabase),
  });

  // ── Master push toggle (profiles.push_enabled) ─────────────────────────────
  const pushQuery = useQuery({
    queryKey: [...notifKeys.prefs(), 'push'] as const,
    queryFn: () => getPushEnabled(supabase),
  });

  // Absent pref row = ON (rule §2.5 — default-on)
  const enabledFor = useCallback(
    (type: NotifPrefInput['type']) =>
      prefs.data?.find((p) => p.type === type && p.channel === 'push')?.enabled ?? true,
    [prefs.data],
  );

  // ── Mutations ─────────────────────────────────────────────────────────────
  const setPref = useMutation({
    mutationFn: (input: NotifPrefInput) => setNotifPref(supabase, input),
    onSuccess: () => void qc.invalidateQueries({ queryKey: notifKeys.prefs() }),
  });

  const setMaster = useMutation({
    mutationFn: (v: boolean) => setPushEnabled(supabase, v),
    onSuccess: () => void qc.invalidateQueries({ queryKey: [...notifKeys.prefs(), 'push'] }),
  });

  return (
    <ScrollView className="flex-1 bg-background" contentContainerClassName="gap-6 pb-12">
      {/* Header */}
      <View className="flex-row items-center gap-3 px-5 pb-2 pt-14">
        <Pressable
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel={t('common.back', locale)}
          hitSlop={8}
        >
          <Text className="text-2xl text-foreground">‹</Text>
        </Pressable>
        <Text className="text-[17px] font-semibold text-foreground">
          {t('notif.prefs.title', locale)}
        </Text>
      </View>

      {/* Subtitle */}
      <Text className="px-5 text-[14px] leading-relaxed text-faint">
        {t('notif.prefs.sub', locale)}
      </Text>

      {/* Per-type toggle rows */}
      <View className="rounded-card border border-hair bg-raise mx-5">
        {PREF_ROWS.map(({ key, type }, idx) => (
          <View
            key={type}
            className={`flex-row items-center justify-between gap-4 px-5 py-4 ${
              idx < PREF_ROWS.length - 1 ? 'border-b border-hair' : ''
            }`}
          >
            <Text className="flex-1 text-base text-foreground">{t(key as MessageKey, locale)}</Text>
            <Switch
              value={enabledFor(type)}
              onValueChange={(v) =>
                setPref.mutate({ type, channel: 'push', enabled: v })
              }
              trackColor={{ false: semantic.raise2, true: semantic.auraSoft }}
              thumbColor={semantic.foreground}
              disabled={setPref.isPending}
            />
          </View>
        ))}
      </View>

      {/* Master push toggle — profiles.push_enabled */}
      <View className="rounded-card border border-hair bg-raise mx-5">
        <View className="flex-row items-center justify-between gap-4 px-5 py-4">
          <View className="flex-1 gap-0.5">
            <Text className="text-base text-foreground">{t('notif.prefs.push', locale)}</Text>
          </View>
          <Switch
            value={pushQuery.data ?? true}
            onValueChange={(v) => setMaster.mutate(v)}
            trackColor={{ false: semantic.raise2, true: semantic.auraSoft }}
            thumbColor={semantic.foreground}
            disabled={setMaster.isPending}
          />
        </View>
      </View>
    </ScrollView>
  );
}
