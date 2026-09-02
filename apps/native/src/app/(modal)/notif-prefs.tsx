import { useCallback, useEffect, useState } from 'react';
import { AppState, Linking, Switch } from 'react-native';
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
import { Button } from '@/components/Button';
import { ModalHeader } from '@/components/ModalHeader';
import { useLocale } from '@/hooks/use-locale';
import { useAuth } from '@/lib/auth-context';
import { devWarn } from '@/lib/log';
import type { PermStatus } from '@/lib/media/permission-status';
import { ensurePushPermission, peekPushPermission } from '@/lib/push';
import { supabase } from '@/lib/supabase';
import { MODAL_A11Y } from '@/lib/a11y';
import { Screen } from '@/components/Screen';

/**
 * Notification preferences (M9 §3.7). 6 per-type push toggles + master push toggle.
 *
 * The master toggle reads TWO facts, not one (#637). `profiles.push_enabled` is a server
 * preference and says nothing about whether the OS will deliver anything: a member who revoked
 * the permission in Settings — or never granted it — saw this switch sitting ON while nothing
 * could arrive, and every per-type row below it promising delivery that was impossible. A
 * preferences screen that lies about the one thing it exists to control is worse than no screen.
 * So the switch shows the CONJUNCTION, and the notice says which half is missing.
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
  { key: 'notif.prefs.projects', type: 'projectResponse' },
  // #127: mutable, unlike 'moderation' and 'gdprExport'. Those two carry no toggle because a
  // member must not be able to silence their own warnings or the delivery of their own data;
  // the fund's broadcasts are news about the community, so muting them costs the member nothing
  // they are owed. One row covers milestones and countdown alike — they share the type.
  { key: 'notif.prefs.fund', type: 'fundMilestone' },
];

export default function NotifPrefsScreen() {
  const { profile } = useAuth();
  const locale = useLocale();
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

  /**
   * The OS half. `null` means "not known yet, or not knowable here" — deliberately distinct from
   * a negative: on a surface where the permission cannot be read at all (expo-web, a peek that
   * throws) the screen must fall back to its old behaviour rather than accuse the member's phone
   * of something. Only a POSITIVE 'blocked'/'undetermined' lights the notice.
   *
   * Re-peeked when the app comes back to the foreground, because the fix for `blocked` happens in
   * Settings — outside this process. Without that the member returns from granting the permission
   * to a screen still insisting it is off.
   */
  const [osStatus, setOsStatus] = useState<PermStatus | null>(null);
  useEffect(() => {
    let cancelled = false;
    const peek = () => {
      void (async () => {
        try {
          const next = await peekPushPermission();
          if (!cancelled) setOsStatus(next);
        } catch (e) {
          devWarn('[notif-prefs] permission peek', e); // stays null — no notice, no false claim
        }
      })();
    };
    peek();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') peek();
    });
    return () => {
      cancelled = true;
      sub.remove();
    };
  }, []);

  // `peekPushPermission` never surfaces 'denied' — a never-asked and an askable-but-declined
  // permission both read as 'undetermined', because from a peek they are the same offer.
  const osOff = osStatus === 'blocked' || osStatus === 'undetermined';
  const masterOn = (pushQuery.data ?? true) && !osOff;

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

  /**
   * Turning the master on while the OS says no asks the OS first, and only writes the preference
   * if the ask succeeds. The alternative — write the row, leave the switch on — is the lie this
   * whole block exists to remove.
   */
  const onMasterChange = useCallback(
    (next: boolean) => {
      if (!next || !osOff) {
        setMaster.mutate(next);
        return;
      }
      void (async () => {
        try {
          const resolved = await ensurePushPermission();
          setOsStatus(resolved);
          // 'blocked' cannot be resolved from here at all — the notice below keeps its Settings
          // link, which is the only thing that can.
          if (resolved === 'granted') setMaster.mutate(true);
        } catch (e) {
          devWarn('[notif-prefs] permission request', e);
        }
      })();
    },
    [osOff, setMaster],
  );

  return (
    <Screen {...MODAL_A11Y}>
      {/* Header — outside the ScrollView so it can't scroll away (#161). */}
      <ModalHeader
        title={t('notif.prefs.title', locale)}
        backLabel={t('common.back', locale)}
        fallbackHref="/(modal)/notifications"
      />
      <ScrollView className="flex-1" contentContainerClassName="gap-6 pb-12">
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
              <Text className="flex-1 text-base text-foreground">
                {t(key as MessageKey, locale)}
              </Text>
              <Switch
                // See trust.tsx: the row's `Text` is a sibling, so the toggle is unnamed without
                // this. One JSX site, six runtime switches — `PREF_ROWS` drives them all (#635).
                accessibilityLabel={t(key as MessageKey, locale)}
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
              accessibilityLabel={t('notif.prefs.push', locale)}
              value={masterOn}
              onValueChange={onMasterChange}
              trackColor={{ false: semantic.raise2, true: semantic.auraSoft }}
              thumbColor={semantic.foreground}
            />
          </View>
          {/* The OS half, stated only when it is positively off. Neutral chrome — this is a fact
              about the phone, not a moment (rule #4). */}
          {osOff ? (
            <View className="gap-3 border-t border-hair px-5 py-4">
              <Text className="text-[13px] leading-relaxed text-faint">
                {t('notif.prefs.osOff', locale)}
              </Text>
              {osStatus === 'blocked' ? (
                <Button
                  label={t('permission.openSettings', locale)}
                  variant="ghost"
                  onPress={() => void Linking.openSettings()}
                />
              ) : null}
            </View>
          ) : null}
        </View>
      </ScrollView>
    </Screen>
  );
}
