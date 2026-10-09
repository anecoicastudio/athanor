import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, useWindowDimensions } from 'react-native';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  type RealizationUpdateCursor,
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
import { galleria } from '@athanor/config';
import { t } from '@athanor/i18n';
import { Pressable, ScrollView, Text, View, cn } from '@/tw';
import { Button } from '@/components/Button';
import { Chip } from '@/components/Chip';
import { EmptyState } from '@/components/EmptyState';
import { Field } from '@/components/Field';
import { KeyboardAvoiding } from '@/components/KeyboardAvoiding';
import { LoadingScreen } from '@/components/LoadingScreen';
import { ModalHeader } from '@/components/ModalHeader';
import { Screen } from '@/components/Screen';
import { SectionLabel } from '@/components/SectionLabel';
import { ProgressUpdateCard } from '@/components/fund/ProgressUpdateCard';
import { useToast } from '@/components/ToastHost';
import { isDraftDirty } from '@/lib/dirty-guard';
import { useAuth } from '@/lib/auth-context';
import { PRESS_DIM } from '@/lib/press';
import { progressRefusalKey } from '@/lib/progress-refusal';
import { supabase } from '@/lib/supabase';
import { stacksTrailing } from '@/lib/type-scale';
import { useActiveEdition } from '@/hooks/use-active-edition';
import { useDirtyGuard } from '@/hooks/use-dirty-guard';
import { useNow } from '@/hooks/use-now';
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
 *
 * The look (Galleria, Marco 2026-10-09, #921): blocks 26 apart on the stage and no card. The
 * note is the field the screen is about; the phase it is about is a row of chips; the author's
 * own notes are one group, each drawing its segment (`fund/ProgressUpdateCard`), with two
 * underlined links under a note and, while one is being corrected, under its field. Nothing
 * here is cyan.
 */
export default function ProgressScreen() {
  const { session } = useAuth();
  const locale = useLocale();
  // At the accessibility sizes a link's line fills its 44pt target: no margin to give back.
  const large = stacksTrailing(useWindowDimensions().fontScale);
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
  // The note's text as it was when the editor opened. Without it the baseline for a
  // correction would be '', and merely OPENING a posted note to re-read it would count as
  // an unsaved change — the guard would then fire on the way out having lost nothing.
  const [editingBaseline, setEditingBaseline] = useState('');
  // Pinned per render pass so every «2 ore fa» in one list agrees with the others.
  const now = useNow();

  // Hoisted: reading `edition.id` inside the body made the compiler infer `edition` as the
  // dependency while the source named `edition?.id`, so the manual memo could not be preserved.
  const editionId = edition?.id;
  const invalidate = useCallback(async () => {
    if (!editionId) return;
    await qc.invalidateQueries({ queryKey: realizationUpdateKeys.mine(editionId) });
    await qc.invalidateQueries({ queryKey: realizationUpdateKeys.feed(editionId) });
  }, [editionId, qc]);

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
  const [composeBaseline] = useState(() => body);
  useDirtyGuard({
    dirty:
      isDraftDirty(composeBaseline, body) ||
      // Gated on `editingId`, not on the text alone: both the save and the cancel path close
      // the editor with `setEditingId(null)` and leave `editingBody` holding the corrected
      // text, so an ungated comparison would stay dirty for the rest of the session.
      (editingId !== null && isDraftDirty(editingBaseline, editingBody)),
    saving: busy,
  });

  if (editionQuery.isLoading || myCandidacyQuery.isLoading) {
    return (
      <Screen>
        {header}
        <LoadingScreen nested />
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

  // `Chip` (#635). The role was already here; the SELECTED state was not, so which phase
  // an update belongs to was conveyed by colour alone — and at py-2 the pill missed 44pt.
  const phaseChip = (id: string | null, label: string) => (
    <Chip
      key={id ?? 'none'}
      label={label}
      selected={phaseId === id}
      onPress={() => setPhaseId(id)}
    />
  );

  // A note's own controls are text links: foreground, underlined, 20 apart (the prototype's
  // `a.sub`). They edit and withdraw PUBLISHED progress, so each is a 44pt target (§10);
  // `-my-3` on the row gives back what the targets add to a 21pt line, except at the
  // accessibility sizes. The row wraps, so a pair wider than the group takes two lines.
  const link = (label: string, onPress: () => void, disabled: boolean) => (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      disabled={disabled}
      className={cn(
        'min-h-[44px] min-w-[44px] justify-center',
        disabled ? 'opacity-40' : null,
        PRESS_DIM,
      )}
    >
      <Text className="type-small text-foreground underline">{label}</Text>
    </Pressable>
  );
  const links = (first: React.ReactNode, second: React.ReactNode) => (
    <View className={cn('flex-row flex-wrap gap-x-5', large ? null : '-my-3')}>
      {first}
      {second}
    </View>
  );

  return (
    <Screen
      footer={
        realizing ? (
          <View className="border-t border-hair px-5 pb-3 pt-3">
            <Button
              label={t('fund.progress.compose.cta', locale)}
              onPress={onPost}
              variant="primary"
              disabled={busy}
            />
          </View>
        ) : undefined
      }
    >
      {header}
      <KeyboardAvoiding>
        <ScrollView className="flex-1" contentContainerClassName="gap-[26px] px-5 pb-12">
          <Text className="type-small text-muted-foreground">
            {t('fund.progress.compose.lead', locale)}
          </Text>
          <Text className="type-small text-muted-foreground">
            {t('fund.progress.public', locale)}
          </Text>

          {/* The cycle left realization: the trail is frozen and the compose surface is
              absent rather than disabled — a box that cannot be sent is worse than none. */}
          {!realizing ? (
            <EmptyState>{t('fund.progress.error.notRealizing', locale)}</EmptyState>
          ) : (
            <>
              <View className="gap-1.5">
                <SectionLabel>{t('fund.progress.compose.label', locale)}</SectionLabel>
                <Field
                  size="lg"
                  multiline
                  maxLength={2000}
                  placeholder={t('fund.progress.compose.placeholder', locale)}
                  value={body}
                  onChangeText={setBody}
                />
              </View>

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
            </>
          )}

          <View className="gap-2">
            <SectionLabel>{t('fund.progress.mine.title', locale)}</SectionLabel>
            {minePage.isLoading ? (
              <ActivityIndicator color={galleria.foreground} />
            ) : mine.length === 0 ? (
              <Text className="type-small text-muted-foreground">
                {t('fund.progress.mine.empty', locale)}
              </Text>
            ) : (
              // One group: the notes draw its segments, so this view sets no gap.
              <View>
                {mine.map((update, i) => {
                  const editing = editingId === update.id;
                  return (
                    <ProgressUpdateCard
                      key={update.id}
                      update={update}
                      phase={phases.find((p) => p.id === update.plan_phase_id) ?? null}
                      locale={locale}
                      now={now}
                      first={i === 0}
                      last={i === mine.length - 1}
                      footer={
                        editing
                          ? links(
                              link(
                                t('fund.progress.edit.save', locale),
                                () =>
                                  editMutation.mutate({ id: update.id, body: editingBody.trim() }),
                                busy || editingBody.trim().length === 0,
                              ),
                              link(
                                t('fund.progress.edit.cancel', locale),
                                () => setEditingId(null),
                                busy,
                              ),
                            )
                          : realizing
                            ? links(
                                link(
                                  t('fund.progress.edit', locale),
                                  () => {
                                    setEditingId(update.id);
                                    setEditingBody(update.body);
                                    setEditingBaseline(update.body);
                                  },
                                  busy,
                                ),
                                link(
                                  t('fund.progress.withdraw', locale),
                                  () => onWithdraw(update.id),
                                  busy,
                                ),
                              )
                            : null
                      }
                    >
                      {/* The note under correction keeps its place in the group; its text
                          becomes a field, named by the control that opened it. */}
                      {editing ? (
                        <Field
                          multiline
                          maxLength={2000}
                          accessibilityLabel={t('fund.progress.edit', locale)}
                          value={editingBody}
                          onChangeText={setEditingBody}
                        />
                      ) : null}
                    </ProgressUpdateCard>
                  );
                })}
              </View>
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

          <Text className="type-small text-muted-foreground">
            {t('fund.progress.zeroAura', locale)}
          </Text>
        </ScrollView>
      </KeyboardAvoiding>
    </Screen>
  );
}
