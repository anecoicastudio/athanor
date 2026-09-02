import { useCallback, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert } from 'react-native';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  type RealizationUpdateCursor,
  type RealizationUpdateRow,
  candidacyKeys,
  deleteRealizationUpdate,
  editRealizationUpdate,
  getMyCandidacy,
  getRealizationPlan,
  getRealizationPlanPhases,
  getRealizationUpdates,
  postRealizationUpdate,
  realizationPlanKeys,
  realizationUpdateKeys,
} from '@athanor/api';
import { semantic } from '@athanor/config';
import { t } from '@athanor/i18n';
import { Pressable, ScrollView, Text, TextInput, View } from '@/tw';
import { Button } from '@/components/Button';
import { Chip } from '@/components/Chip';
import { EmptyState } from '@/components/EmptyState';
import { KeyboardAvoiding } from '@/components/KeyboardAvoiding';
import { ModalHeader } from '@/components/ModalHeader';
import { Screen } from '@/components/Screen';
import { SectionLabel } from '@/components/SectionLabel';
import { ProgressUpdateCard } from '@/components/fund/ProgressUpdateCard';
import { useToast } from '@/components/ToastHost';
import { isDraftDirty } from '@/lib/dirty-guard';
import { useAuth } from '@/lib/auth-context';
import { progressRefusalKey } from '@/lib/progress-refusal';
import { supabase } from '@/lib/supabase';
import { useActiveEdition } from '@/hooks/use-active-edition';
import { useDirtyGuard } from '@/hooks/use-dirty-guard';
import { useLocale } from '@/hooks/use-locale';

/**
 * The winner tells the community how it is going (#230, FUND-26).
 *
 * WHAT THIS SCREEN IS NOT: a gate. Nothing written here moves the cycle, releases a tranche
 * or declares the dream realized — closure is `close_cycle()`'s operator act and the release
 * gate is #231's phase verification. These notes are evidence and transparency, which is
 * also why they cost nothing to write and earn nothing (rule #1).
 *
 * Every condition is the server's, surfaced rather than pre-guessed: RLS pins the author to
 * the caller and the cycle to 'realization', the binds_winner trigger refuses anyone who is
 * not the cycle's confirmed winner, and #106's restrictive net refuses a suspended member.
 * The screen hides what it knows is pointless to show; it never decides on the database's
 * behalf what would have been allowed.
 */
export default function ProgressScreen() {
  const { session } = useAuth();
  const locale = useLocale();
  const uid = session?.user.id ?? '';
  const qc = useQueryClient();
  const { showToast } = useToast();

  const editionQuery = useActiveEdition();
  const edition = editionQuery.data ?? null;

  const myCandidacyQuery = useQuery({
    queryKey: candidacyKeys.mine(edition?.id ?? ''),
    queryFn: () => getMyCandidacy(supabase, edition!.id, uid),
    enabled: !!edition?.id && uid !== '',
  });
  const myCandidacy = myCandidacyQuery.data ?? null;

  const isWinner =
    !!edition?.winner_candidacy_id &&
    !!myCandidacy &&
    edition.winner_candidacy_id === myCandidacy.id &&
    edition.winner_confirmed_at !== null;
  const realizing = edition?.phase === 'realization';

  // The plan's phases, for «which phase is this about». Read only when there is something to
  // write: the picker is an optional refinement, never a required step.
  const planQuery = useQuery({
    queryKey: realizationPlanKeys.byEdition(edition?.id ?? ''),
    queryFn: () => getRealizationPlan(supabase, edition!.id),
    enabled: !!edition?.id && isWinner && realizing,
  });
  const plan = planQuery.data ?? null;
  const phasesQuery = useQuery({
    queryKey: realizationPlanKeys.phases(plan?.id ?? ''),
    queryFn: () => getRealizationPlanPhases(supabase, plan!.id),
    enabled: !!plan?.id,
  });
  const phases = useMemo(() => phasesQuery.data ?? [], [phasesQuery.data]);

  // The author's own trail, withdrawn notes included — the one place a withdrawal stays
  // visible, so pulling a note back is recoverable by the person who pulled it.
  const minePage = useInfiniteQuery({
    queryKey: realizationUpdateKeys.mine(edition?.id ?? ''),
    queryFn: ({ pageParam }) =>
      getRealizationUpdates(supabase, edition!.id, {
        cursor: pageParam as RealizationUpdateCursor | null,
        includeWithdrawn: true,
      }),
    initialPageParam: null as RealizationUpdateCursor | null,
    getNextPageParam: (last) => last.nextCursor,
    enabled: !!edition?.id && isWinner,
  });
  const mine = useMemo(() => minePage.data?.pages.flatMap((p) => p.rows) ?? [], [minePage.data]);

  // ── Compose ──────────────────────────────────────────────────────────────────
  const [body, setBody] = useState('');
  const [phaseId, setPhaseId] = useState<string | null>(null);
  // Which row is open for correction, and the text under correction. One at a time: two
  // open editors on one trail is a way to save the wrong one.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingBody, setEditingBody] = useState('');
  // Pinned per render pass so every «2 ore fa» in one list agrees with the others.
  const now = useRef(Date.now()).current;

  const invalidate = useCallback(async () => {
    if (!edition?.id) return;
    await qc.invalidateQueries({ queryKey: realizationUpdateKeys.mine(edition.id) });
    await qc.invalidateQueries({ queryKey: realizationUpdateKeys.feed(edition.id) });
  }, [edition?.id, qc]);

  const postMutation = useMutation({
    mutationFn: () =>
      postRealizationUpdate(supabase, {
        edition_id: edition!.id,
        profile_id: uid,
        plan_phase_id: phaseId,
        body: body.trim(),
      }),
    onSuccess: async () => {
      showToast(t('fund.progress.posted', locale), 'success');
      setBody('');
      setPhaseId(null);
      await invalidate();
    },
    onError: (error) => Alert.alert(t(progressRefusalKey(error), locale)),
  });

  const editMutation = useMutation({
    mutationFn: (input: { id: string; body: string }) =>
      editRealizationUpdate(supabase, input.id, { body: input.body }),
    onSuccess: async () => {
      showToast(t('fund.progress.saved', locale), 'success');
      setEditingId(null);
      await invalidate();
    },
    onError: (error) => Alert.alert(t(progressRefusalKey(error), locale)),
  });

  const withdrawMutation = useMutation({
    mutationFn: (id: string) => deleteRealizationUpdate(supabase, id, new Date().toISOString()),
    onSuccess: async () => {
      showToast(t('fund.progress.withdraw.done', locale), 'success');
      await invalidate();
    },
    onError: (error) => Alert.alert(t(progressRefusalKey(error), locale)),
  });

  const onPost = useCallback(() => {
    if (body.trim().length === 0) {
      showToast(t('fund.progress.error.empty', locale));
      return;
    }
    postMutation.mutate();
  }, [body, locale, postMutation, showToast]);

  const onWithdraw = useCallback(
    (id: string) => {
      Alert.alert(
        t('fund.progress.withdraw.title', locale),
        t('fund.progress.withdraw.body', locale),
        [
          { text: t('common.cancel', locale), style: 'cancel' },
          {
            text: t('fund.progress.withdraw', locale),
            style: 'destructive',
            onPress: () => withdrawMutation.mutate(id),
          },
        ],
      );
    },
    [locale, withdrawMutation],
  );

  const header = (
    <ModalHeader
      title={t('fund.progress.compose.title', locale)}
      backLabel={t('common.back', locale)}
    />
  );

  const busy = postMutation.isPending || editMutation.isPending || withdrawMutation.isPending;
  // #636. The only roster screen that is NOT a sheet — `progress` has no <Stack.Screen> entry
  // in (modal)/_layout.tsx, so it presents as a push card and its gesture is the iOS left-edge
  // back-swipe rather than a swipe-down. `usePreventRemove` covers both. Two drafts live here:
  // the new note being composed, and a posted note reopened for correction.
  useDirtyGuard({
    dirty: isDraftDirty({ body: '', editingBody: '' }, { body, editingBody }),
    saving: busy,
  });

  if (editionQuery.isLoading || myCandidacyQuery.isLoading) {
    return (
      <Screen>
        {header}
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color={semantic.aura} />
        </View>
      </Screen>
    );
  }

  if (!edition) {
    return (
      <Screen>
        {header}
        <View className="flex-1 items-center justify-center px-5">
          <EmptyState>{t('fund.noCycle', locale)}</EmptyState>
        </View>
      </Screen>
    );
  }

  // Nothing routes here for a non-winner, but a deep link can. Say whose trail it is not,
  // rather than showing a compose box the database would refuse.
  if (!isWinner) {
    return (
      <Screen>
        {header}
        <View className="flex-1 items-center justify-center px-5">
          <EmptyState>{t('fund.progress.error.notWinner', locale)}</EmptyState>
        </View>
      </Screen>
    );
  }

  // `Chip small` (#635). The role was already here; the SELECTED state was not, so which phase
  // an update belongs to was conveyed by cyan alone — and at py-2 the pill missed 44pt.
  const phaseChip = (id: string | null, label: string) => (
    <Chip
      key={id ?? 'none'}
      small
      label={label}
      selected={phaseId === id}
      onPress={() => setPhaseId(id)}
    />
  );

  // The four own-update controls (edit/withdraw here, save/cancel in the editor below) were
  // 12px labels with no padding and no hitSlop — ~15pt targets. They edit and withdraw
  // PUBLISHED progress, so §10's floor is not optional on them.
  const ownControls = (update: RealizationUpdateRow) =>
    update.deleted_at ? null : (
      <View className="flex-row gap-4 pt-1">
        <Pressable
          onPress={() => {
            setEditingId(update.id);
            setEditingBody(update.body);
          }}
          accessibilityRole="button"
          disabled={busy}
          className="min-h-[44px] min-w-[44px] items-center justify-center"
        >
          <Text className="text-[12px] text-muted-foreground">
            {t('fund.progress.edit', locale)}
          </Text>
        </Pressable>
        <Pressable
          onPress={() => onWithdraw(update.id)}
          accessibilityRole="button"
          disabled={busy}
          className="min-h-[44px] min-w-[44px] items-center justify-center"
        >
          <Text className="text-[12px] text-muted-foreground">
            {t('fund.progress.withdraw', locale)}
          </Text>
        </Pressable>
      </View>
    );

  return (
    <Screen
      footer={
        realizing ? (
          <View className="px-5 pb-2">
            <Button
              label={t('fund.progress.compose.cta', locale)}
              onPress={onPost}
              variant="light"
              disabled={busy}
              // Flat cyan CTA — no glow (rule #4): a progress note is the ordinary rhythm
              // of a realization, not a moment.
            />
          </View>
        ) : undefined
      }
    >
      {header}
      <KeyboardAvoiding>
        <ScrollView className="flex-1" contentContainerClassName="gap-8 px-5 pb-12">
          <View className="gap-2">
            <Text className="text-[14px] leading-5 text-foreground">
              {t('fund.progress.compose.lead', locale)}
            </Text>
            <Text className="text-[12px] text-muted-foreground">
              {t('fund.progress.public', locale)}
            </Text>
          </View>

          {/* The cycle left realization: the trail is frozen and the compose surface is
              absent rather than disabled — a box that cannot be sent is worse than none. */}
          {!realizing ? (
            <EmptyState>{t('fund.progress.error.notRealizing', locale)}</EmptyState>
          ) : (
            <View className="gap-3">
              <SectionLabel>{t('fund.progress.compose.label', locale)}</SectionLabel>
              <TextInput
                className="min-h-[120px] rounded-card border border-hair bg-raise p-5 text-[15px] leading-6 text-foreground"
                value={body}
                onChangeText={setBody}
                multiline
                maxLength={2000}
                placeholder={t('fund.progress.compose.placeholder', locale)}
                placeholderTextColor={semantic.foregroundMuted}
              />

              {phases.length > 0 ? (
                <View className="gap-2">
                  <SectionLabel>{t('fund.progress.compose.phase.label', locale)}</SectionLabel>
                  <View className="flex-row flex-wrap gap-2">
                    {phaseChip(null, t('fund.progress.compose.phase.none', locale))}
                    {phases.map((phase) =>
                      phaseChip(
                        phase.id,
                        t('fund.progress.phase', locale, {
                          n: String(phase.sort),
                          title: phase.title,
                        }),
                      ),
                    )}
                  </View>
                </View>
              ) : null}
            </View>
          )}

          <View className="gap-3">
            <SectionLabel>{t('fund.progress.mine.title', locale)}</SectionLabel>
            {minePage.isLoading ? (
              <ActivityIndicator color={semantic.aura} />
            ) : mine.length === 0 ? (
              <Text className="text-[14px] text-muted-foreground">
                {t('fund.progress.mine.empty', locale)}
              </Text>
            ) : (
              <View className="gap-4">
                {mine.map((update) =>
                  editingId === update.id ? (
                    <View
                      key={update.id}
                      className="gap-3 rounded-card border border-hair bg-raise p-5"
                    >
                      <TextInput
                        className="min-h-[100px] text-[15px] leading-6 text-foreground"
                        value={editingBody}
                        onChangeText={setEditingBody}
                        multiline
                        maxLength={2000}
                      />
                      <View className="flex-row gap-4">
                        <Pressable
                          onPress={() =>
                            editMutation.mutate({ id: update.id, body: editingBody.trim() })
                          }
                          accessibilityRole="button"
                          disabled={busy || editingBody.trim().length === 0}
                          className="min-h-[44px] min-w-[44px] items-center justify-center"
                        >
                          <Text className="text-[12px] text-aura">
                            {t('fund.progress.edit.save', locale)}
                          </Text>
                        </Pressable>
                        <Pressable
                          onPress={() => setEditingId(null)}
                          accessibilityRole="button"
                          disabled={busy}
                          className="min-h-[44px] min-w-[44px] items-center justify-center"
                        >
                          <Text className="text-[12px] text-muted-foreground">
                            {t('fund.progress.edit.cancel', locale)}
                          </Text>
                        </Pressable>
                      </View>
                    </View>
                  ) : (
                    <ProgressUpdateCard
                      key={update.id}
                      update={update}
                      phase={phases.find((p) => p.id === update.plan_phase_id) ?? null}
                      locale={locale}
                      now={now}
                      footer={realizing ? ownControls(update) : null}
                    />
                  ),
                )}
                {minePage.hasNextPage ? (
                  <Button
                    label={t('fund.progress.more', locale)}
                    onPress={() => void minePage.fetchNextPage()}
                    variant="ghost"
                    disabled={minePage.isFetchingNextPage}
                  />
                ) : null}
              </View>
            )}
          </View>

          <Text className="text-[12px] text-muted-foreground">
            {t('fund.progress.zeroAura', locale)}
          </Text>
        </ScrollView>
      </KeyboardAvoiding>
    </Screen>
  );
}
