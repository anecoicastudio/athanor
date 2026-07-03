import { useCallback } from 'react';
import { Switch } from 'react-native';
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
import type { NotifPrefInput, NotificationPreference } from '@athanor/schemas';
import { ScrollView, Text, View } from '@/tw';
import { ModalHeader } from '@/components/ModalHeader';
import { useAuth } from '@/lib/auth-context';
import { supabase } from '@/lib/supabase';
import { MODAL_A11Y } from '@/lib/a11y';

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
  const { profile } = useAuth();
  const locale = profile?.locale ?? 'it';
  const qc = useQueryClient();

  // ── Per-type preferences ───────────────────────────────────────────────────
  const prefs = useQuery({
    queryKey: notifKeys.prefs(),
    queryFn: () => getPreferences(supabase),
  });

  // ── Master push toggle (profiles.push_enabled) ─────────────────────────────
  const pushKey = [...notifKeys.prefs(), 'push'] as const;
  const pushQuery = useQuery({
    queryKey: pushKey,
    queryFn: () => getPushEnabled(supabase),
  });

  // Absent pref row = ON (rule §2.5 — default-on)
  const enabledFor = useCallback(
    (type: NotifPrefInput['type']) =>
      prefs.data?.find((p) => p.type === type && p.channel === 'push')?.enabled ?? true,
    [prefs.data],
  );

  // ── Mutations ─────────────────────────────────────────────────────────────
  // Optimistic: flip the cached row immediately so the Switch responds instantly; roll back on error.
  const setPref = useMutation({
    mutationFn: (input: NotifPrefInput) => setNotifPref(supabase, input),
    onMutate: async (input) => {
      await qc.cancelQueries({ queryKey: notifKeys.prefs() });
      const prev = qc.getQueryData<NotificationPreference[]>(notifKeys.prefs());
      qc.setQueryData<NotificationPreference[]>(notifKeys.prefs(), (old) => {
        const list = old ?? [];
        const i = list.findIndex((p) => p.type === input.type && p.channel === input.channel);
        if (i >= 0) {
          const copy = [...list];
          copy[i] = { ...copy[i]!, enabled: input.enabled };
          return copy;
        }
        const now = new Date().toISOString();
        return [
          ...list,
          {
            id: `optimistic-${input.type}-${input.channel}`,
            profile_id: profile?.id ?? '',
            type: input.type,
            channel: input.channel,
            enabled: input.enabled,
            created_at: now,
            updated_at: now,
          },
        ];
      });
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(notifKeys.prefs(), ctx.prev);
    },
    onSettled: () => void qc.invalidateQueries({ queryKey: notifKeys.prefs() }),
  });

  const setMaster = useMutation({
    mutationFn: (v: boolean) => setPushEnabled(supabase, v),
    onMutate: async (v) => {
      await qc.cancelQueries({ queryKey: pushKey });
      const prev = qc.getQueryData<boolean>(pushKey);
      qc.setQueryData<boolean>(pushKey, v);
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev !== undefined) qc.setQueryData(pushKey, ctx.prev);
    },
    onSettled: () => void qc.invalidateQueries({ queryKey: pushKey }),
  });

  return (
    <ScrollView
      {...MODAL_A11Y}
      className="flex-1 bg-background"
      contentContainerClassName="gap-6 pb-12"
    >
      {/* Header */}
      <ModalHeader title={t('notif.prefs.title', locale)} backLabel={t('common.back', locale)} />

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
              onValueChange={(v) => setPref.mutate({ type, channel: 'push', enabled: v })}
              trackColor={{ false: semantic.raise2, true: semantic.auraSoft }}
              thumbColor={semantic.foreground}
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
          />
        </View>
      </View>
    </ScrollView>
  );
}
