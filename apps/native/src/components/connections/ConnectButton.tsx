import { AccessibilityInfo } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  cancelConnection,
  connectionKeys,
  conversationKeys,
  getConnectionStatus,
  respondToConnection,
  sendConnection,
} from '@athanor/api';
import { type Locale, t } from '@athanor/i18n';
import { Pressable, Text, View } from '@/tw';
import { HIT_SLOP } from '@/lib/a11y';
import { Button } from '@/components/Button';
import { useToast } from '@/components/ToastHost';
import { useAuth } from '@/lib/auth-context';
import { supabase } from '@/lib/supabase';

/**
 * Profile action: send / cancel / accept-decline / connected, driven by the live
 * connection status for `peerId`. Flat cyan only (rule #4) — a connection is routine,
 * never a glow moment, which is also why its toasts carry no tone mark. Aura is never
 * written here (rule #1). Feedback goes through the global toast host (#118); the
 * private pill this component hand-rolled was the last ad-hoc Toast variant on the
 * profile screen.
 */
export function ConnectButton({ peerId, locale }: { peerId: string; locale: Locale }) {
  const queryClient = useQueryClient();
  const { session } = useAuth();
  const { showToast } = useToast();

  const statusQuery = useQuery({
    queryKey: connectionKeys.status(peerId),
    queryFn: () => getConnectionStatus(supabase, peerId),
    // getConnectionStatus needs auth.uid(); don't run (and cache a false 'none') before the
    // session has restored — refetches once it lands.
    enabled: Boolean(session?.user),
  });

  // status for this peer + the inbox + the connections list all change on send/cancel/accept,
  // so invalidate the whole connections tree (cheap, keeps every surface in sync).
  const resyncStatus = () =>
    void queryClient.invalidateQueries({ queryKey: connectionKeys.status(peerId) });
  const invalidateAll = () => void queryClient.invalidateQueries({ queryKey: connectionKeys.all });

  const sendMutation = useMutation({
    mutationFn: () => sendConnection(supabase, peerId),
    onSuccess: () => {
      invalidateAll();
      // No toast: the button itself flips to «Richiesta inviata» — the state change IS
      // the feedback, and the removed toast said those exact words over it (#118).
      // Screen readers can't see the flip, so announce the new state once.
      AccessibilityInfo.announceForAccessibility(t('connection.pending', locale));
    },
    onError: () => {
      resyncStatus();
      showToast(t('connection.failed', locale));
    },
  });

  const cancelMutation = useMutation({
    mutationFn: (requestId: string) => cancelConnection(supabase, requestId),
    onSuccess: () => {
      invalidateAll();
      showToast(t('connection.cancelled.toast', locale));
    },
    onError: () => {
      resyncStatus();
      showToast(t('connection.failed', locale));
    },
  });

  const respondMutation = useMutation({
    mutationFn: ({ requestId, accept }: { requestId: string; accept: boolean }) =>
      respondToConnection(supabase, requestId, accept),
    onSuccess: (_data, variables) => {
      invalidateAll();
      if (variables.accept) {
        // An accept created a 1:1 chat — refresh the conversations list.
        void queryClient.invalidateQueries({ queryKey: conversationKeys.list() });
        showToast(t('connection.accepted.toast', locale));
      }
    },
    onError: () => {
      resyncStatus();
      showToast(t('connection.failed', locale));
    },
  });

  const pending = sendMutation.isPending || cancelMutation.isPending || respondMutation.isPending;
  const state = statusQuery.data?.state ?? 'none';
  const requestId = statusQuery.data?.requestId ?? null;

  return (
    <View className="flex-1 gap-2">
      {state === 'none' ? (
        <Button
          label={t('connection.cta', locale)}
          variant="light"
          disabled={pending || statusQuery.isLoading}
          onPress={() => sendMutation.mutate()}
        />
      ) : null}

      {state === 'pending-out' ? (
        <View className="gap-2">
          <Button
            label={t('connection.pending', locale)}
            variant="ghost"
            disabled
            onPress={() => {}}
          />
          <Pressable
            accessibilityRole="button"
            disabled={pending || !requestId}
            hitSlop={HIT_SLOP}
            onPress={() => requestId && cancelMutation.mutate(requestId)}
          >
            <Text className={`text-center text-[13px] text-faint ${pending ? 'opacity-40' : ''}`}>
              {t('connection.cancel', locale)}
            </Text>
          </Pressable>
        </View>
      ) : null}

      {state === 'pending-in' ? (
        <View className="flex-row items-center gap-3">
          <View className="flex-1">
            <Button
              label={t('connection.accept', locale)}
              variant="light"
              disabled={pending || !requestId}
              onPress={() => requestId && respondMutation.mutate({ requestId, accept: true })}
            />
          </View>
          <View className="flex-1">
            <Button
              label={t('connection.decline', locale)}
              variant="ghost"
              disabled={pending || !requestId}
              onPress={() => requestId && respondMutation.mutate({ requestId, accept: false })}
            />
          </View>
        </View>
      ) : null}

      {state === 'connected' ? (
        <Button
          label={t('connection.connected', locale)}
          variant="ghost"
          disabled
          onPress={() => {}}
        />
      ) : null}
    </View>
  );
}
