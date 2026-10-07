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
import { Text, View } from '@/tw';
import { spoken } from '@/lib/star';
import { Button } from '@/components/Button';
import { ButtonRow } from '@/components/ButtonRow';
import { useToast } from '@/components/ToastHost';
import { useAuth } from '@/lib/auth-context';
import { supabase } from '@/lib/supabase';

/**
 * Profile action: send / cancel / accept-decline / connected, driven by the live
 * connection status for `peerId`. White and outline pills, one text link and grey words: a
 * connection is routine, never a moment, which is also why its toasts carry no tone mark and
 * nothing here is cyan (DESIGN §2.3). Aura is never written here (rule #1). Feedback goes
 * through the global toast host (#118); the private pill this component hand-rolled was the
 * last ad-hoc Toast variant on the profile screen.
 *
 * A STATUS is words, not a control (Galleria, 2026-10-07, #921): «Richiesta inviata» and
 * «Connessi ✦» are `small` grey text. Until then each was a disabled text link with an empty
 * press, which read as a link that cannot be followed.
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
      // No toast: the pill itself gives way to «Richiesta inviata» — the state change IS
      // the feedback, and the removed toast said those exact words over it (#118).
      // Screen readers can't see the flip, so announce the new state once.
      AccessibilityInfo.announceForAccessibility(spoken(t('connection.pending', locale)));
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
    // No `flex-1`: this renders as one cell of the caller's `ButtonRow`, sized to its content
    // (#833). While answering a request its two pills are a `ButtonRow` of their own, so the
    // footer reads «Scrivi» · «Accetta» · «Rifiuta» and the pair drops a line only when it
    // does not fit — no label ever breaks.
    <View className="gap-2">
      {state === 'none' ? (
        <Button
          label={t('connection.cta', locale)}
          variant="primary"
          disabled={pending || statusQuery.isLoading}
          onPress={() => sendMutation.mutate()}
        />
      ) : null}

      {state === 'pending-out' ? (
        <View className="items-center">
          <Text className="text-center type-small text-muted-foreground">
            {t('connection.pending', locale)}
          </Text>
          <Button
            label={t('connection.cancel', locale)}
            variant="ghost"
            disabled={pending || !requestId}
            onPress={() => requestId && cancelMutation.mutate(requestId)}
          />
        </View>
      ) : null}

      {state === 'pending-in' ? (
        <ButtonRow>
          <Button
            label={t('connection.accept', locale)}
            variant="primary"
            disabled={pending || !requestId}
            onPress={() => requestId && respondMutation.mutate({ requestId, accept: true })}
          />
          <Button
            label={t('connection.decline', locale)}
            variant="outline"
            disabled={pending || !requestId}
            onPress={() => requestId && respondMutation.mutate({ requestId, accept: false })}
          />
        </ButtonRow>
      ) : null}

      {state === 'connected' ? (
        <Text className="text-center type-small text-muted-foreground">
          {t('connection.connected', locale)}
        </Text>
      ) : null}
    </View>
  );
}
