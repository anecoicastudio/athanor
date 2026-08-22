import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  addRealizationPlanPhase,
  candidacyKeys,
  createRealizationPlan,
  deleteRealizationPlanPhase,
  fundKeys,
  getMyCandidacy,
  getRealizationPlan,
  getRealizationPlanPhases,
  publishRealizationPlan,
  realizationPlanKeys,
  updateRealizationPlan,
  updateRealizationPlanPhase,
} from '@athanor/api';
import { formatFundTotal, payableCents, remainingPayableCents } from '@athanor/core';
import { semantic } from '@athanor/config';
import { t } from '@athanor/i18n';
import { ScrollView, Text, TextInput, View } from '@/tw';
import { Button } from '@/components/Button';
import { EmptyState } from '@/components/EmptyState';
import { KeyboardAvoiding } from '@/components/KeyboardAvoiding';
import { ModalHeader } from '@/components/ModalHeader';
import { Screen } from '@/components/Screen';
import { SectionLabel } from '@/components/SectionLabel';
import { PlanPhaseCard } from '@/components/fund/PlanPhaseCard';
import { useToast } from '@/components/ToastHost';
import { useAuth } from '@/lib/auth-context';
import { planRefusalKey } from '@/lib/plan-refusal';
import {
  costedCents,
  type DraftPhase,
  draftFromPhases,
  phaseComplete,
  phaseDiff,
} from '@/lib/plan-draft';
import { supabase } from '@/lib/supabase';
import { calendarDay, dayKey } from '@/lib/time';
import { useActiveEdition } from '@/hooks/use-active-edition';

/**
 * The winner's realization plan (#229, FUND-25) — authored AFTER the cycle chose the dream,
 * and costed to `confirmed_pool_cents`, the money that exists, never to the budget the
 * candidacy asked for.
 *
 * The ceiling is rendered, never enforced here. A phase that would take the plan past the
 * cycle's declared payable is refused by the database and the refusal is shown as itself
 * («the phases go past the available amount»); the screen does not clamp the number the
 * member typed into one it prefers. Same for publication: every condition — authorship,
 * cycle phase, «at least one phase» — is the server's ladder, surfaced, not pre-guessed.
 *
 * Publication is one-way. After it the plan is the public commitment tranches release
 * against, the cycle enters realization, and every field here becomes read-only because the
 * database will refuse a write regardless.
 */
export default function RealizationPlanScreen() {
  const { profile, session } = useAuth();
  const locale = profile?.locale ?? 'it';
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

  // The winner is the cycle's declared winner, and only after they confirmed the dream is
  // deliverable at the snapshotted figure (#220) — that confirmation is what #228's trigger
  // requires before a plan may exist at all.
  const isWinner =
    !!edition?.winner_candidacy_id &&
    !!myCandidacy &&
    edition.winner_candidacy_id === myCandidacy.id &&
    edition.winner_confirmed_at !== null;

  const planQuery = useQuery({
    queryKey: realizationPlanKeys.byEdition(edition?.id ?? ''),
    queryFn: () => getRealizationPlan(supabase, edition!.id),
    enabled: !!edition?.id && isWinner,
  });
  const plan = planQuery.data ?? null;

  const phasesQuery = useQuery({
    queryKey: realizationPlanKeys.phases(plan?.id ?? ''),
    queryFn: () => getRealizationPlanPhases(supabase, plan!.id),
    enabled: !!plan?.id,
  });
  const serverPhases = useMemo(() => phasesQuery.data ?? [], [phasesQuery.data]);

  const published = plan?.published_at != null;

  // ── Local draft ──────────────────────────────────────────────────────────────
  const [objective, setObjective] = useState('');
  const [expectedResult, setExpectedResult] = useState('');
  const [professionals, setProfessionals] = useState('');
  const [suppliers, setSuppliers] = useState('');
  const [phases, setPhases] = useState<DraftPhase[]>([]);
  // The server row is the draft's origin exactly once per load; after that the member's
  // typing owns the fields, so a background refetch never overwrites what they are writing.
  const [hydrated, setHydrated] = useState(false);
  // The phases get their own flag rather than reading «is the list empty?»: an empty list is
  // a legitimate draft state — the member just removed the last phase — and re-hydrating on
  // it would resurrect the phase on the next background refetch.
  const [phasesHydrated, setPhasesHydrated] = useState(false);

  useEffect(() => {
    if (hydrated || !plan) return;
    setObjective(plan.objective);
    setExpectedResult(plan.expected_result);
    setProfessionals(plan.professionals);
    setSuppliers(plan.suppliers);
    setHydrated(true);
  }, [hydrated, plan]);

  useEffect(() => {
    if (phasesHydrated || !plan || phasesQuery.data === undefined) return;
    setPhases(draftFromPhases(serverPhases));
    setPhasesHydrated(true);
  }, [phasesHydrated, plan, phasesQuery.data, serverPhases]);

  const payable = payableCents(edition?.confirmed_pool_cents ?? 0, edition?.split_pct ?? 0);
  const costed = costedCents(phases);
  const remaining = remainingPayableCents(
    edition?.confirmed_pool_cents ?? 0,
    edition?.split_pct ?? 0,
    costed,
  );

  const proseComplete = objective.trim().length > 0 && expectedResult.trim().length > 0;
  const phasesAllComplete = phases.every(phaseComplete);

  // Monotonic, never derived from the list. A key computed from the current phases can be
  // handed out twice — remove one of two new phases and the next add recomputes the key the
  // survivor still holds, which React reads as the same row.
  const nextPhaseKey = useRef(0);

  const addPhase = useCallback(() => {
    setPhases((current) => [
      ...current,
      {
        // A local key that is not an id: this phase has no row yet.
        key: `new-${nextPhaseKey.current++}`,
        id: null,
        title: '',
        scheduledFor: dayKey(new Date().toISOString()),
        amountCents: null,
        criteria: '',
      },
    ]);
  }, []);

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!edition || !myCandidacy) throw new Error('no cycle');
      const patch = {
        objective: objective.trim(),
        expected_result: expectedResult.trim(),
        professionals: professionals.trim(),
        suppliers: suppliers.trim(),
      };
      const saved = plan
        ? await updateRealizationPlan(supabase, plan.id, patch)
        : await createRealizationPlan(supabase, {
            edition_id: edition.id,
            candidacy_id: myCandidacy.id,
            ...patch,
          });

      // Deletes → updates → inserts (lib/plan-draft `applyOrder`): removing a phase or
      // re-costing one downward frees ceiling headroom that a new phase may need, and an
      // insert-first order would be refused on a plan that in fact fits.
      const diff = phaseDiff(serverPhases, phases);
      for (const id of diff.deletes) await deleteRealizationPlanPhase(supabase, id);
      for (const { id, patch: p } of diff.updates)
        await updateRealizationPlanPhase(supabase, id, p);
      for (const insert of diff.inserts)
        await addRealizationPlanPhase(supabase, { ...insert, plan_id: saved.id });
      return saved;
    },
    onSuccess: async (saved) => {
      showToast(t('fund.plan.saved', locale), 'success');
      await qc.invalidateQueries({ queryKey: realizationPlanKeys.byEdition(saved.edition_id) });
      const fresh = await getRealizationPlanPhases(supabase, saved.id);
      qc.setQueryData(realizationPlanKeys.phases(saved.id), fresh);
      setPhases(draftFromPhases(fresh));
    },
    onError: (error) => Alert.alert(t(planRefusalKey(error), locale)),
  });

  const publishMutation = useMutation({
    mutationFn: () => publishRealizationPlan(supabase, plan!.id),
    onSuccess: async () => {
      showToast(t('fund.plan.publish.done', locale), 'success');
      await qc.invalidateQueries({ queryKey: realizationPlanKeys.all });
      await qc.invalidateQueries({ queryKey: fundKeys.activeEdition() });
    },
    onError: (error) => Alert.alert(t(planRefusalKey(error), locale)),
  });

  // A missing field is a nudge and passes as a toast; a SERVER refusal is an Alert, because
  // «the phases go past the available amount» is news about money and must be acknowledged,
  // not caught in the 2.5s a toast holds. (There is no error toast tone in this app, and
  // inventing one for this screen would be a second convention for the same job.)
  const onSave = useCallback(() => {
    if (!proseComplete) {
      showToast(t('fund.plan.error.incomplete', locale));
      return;
    }
    if (!phasesAllComplete) {
      showToast(t('fund.plan.error.phaseIncomplete', locale));
      return;
    }
    saveMutation.mutate();
  }, [proseComplete, phasesAllComplete, locale, showToast, saveMutation]);

  const onPublish = useCallback(() => {
    Alert.alert(t('fund.plan.publish.title', locale), t('fund.plan.publish.body', locale), [
      { text: t('common.cancel', locale), style: 'cancel' },
      { text: t('fund.plan.publish.cta', locale), onPress: () => publishMutation.mutate() },
    ]);
  }, [locale, publishMutation]);

  const header = (
    <ModalHeader title={t('fund.plan.title', locale)} backLabel={t('common.back', locale)} />
  );

  if (editionQuery.isLoading || myCandidacyQuery.isLoading || planQuery.isLoading) {
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

  // Nothing routes here for a non-winner, but a deep link can: say whose plan it is not,
  // rather than showing an empty form the database would refuse.
  if (!isWinner) {
    return (
      <Screen>
        {header}
        <View className="flex-1 items-center justify-center px-5">
          <EmptyState>{t('fund.plan.error.notAuthor', locale)}</EmptyState>
        </View>
      </Screen>
    );
  }

  const busy = saveMutation.isPending || publishMutation.isPending;

  const proseField = (
    label: string,
    hint: string | null,
    value: string,
    onChangeText: (v: string) => void,
  ) => (
    <View className="gap-2">
      <SectionLabel>{label}</SectionLabel>
      {published ? (
        <Text className="text-[15px] leading-6 text-foreground">{value || '—'}</Text>
      ) : (
        <TextInput
          className="rounded-card border border-hair bg-raise p-5 text-[15px] leading-6 text-foreground"
          value={value}
          onChangeText={onChangeText}
          multiline
          placeholderTextColor={semantic.foregroundMuted}
        />
      )}
      {hint ? <Text className="text-[12px] text-muted-foreground">{hint}</Text> : null}
    </View>
  );

  return (
    <Screen
      footer={
        published ? undefined : (
          <View className="gap-2 px-5 pb-2">
            <Button
              label={t('fund.plan.save', locale)}
              onPress={onSave}
              variant="primary"
              disabled={busy}
            />
            {plan && phases.length > 0 ? (
              <Button
                label={t('fund.plan.publish.cta', locale)}
                onPress={onPublish}
                variant="light"
                disabled={busy}
                // Flat cyan CTA — no glow (rule #4): the moment is the publication itself,
                // and it is announced by the state it leaves behind, not by the button.
              />
            ) : null}
          </View>
        )
      }
    >
      {header}
      <KeyboardAvoiding>
        <ScrollView className="flex-1" contentContainerClassName="gap-8 px-5 pb-12">
          <View className="gap-2">
            <Text className="text-[14px] leading-5 text-foreground">
              {t('fund.plan.lead', locale)}
            </Text>
            <Text className="text-[12px] text-muted-foreground">
              {published
                ? t('fund.plan.published', locale, {
                    date: calendarDay(dayKey(plan.published_at as string), locale),
                  })
                : t('fund.plan.draft', locale)}
            </Text>
            {published ? (
              <Text className="text-[12px] text-muted-foreground">
                {t('fund.plan.publishedNote', locale)}
              </Text>
            ) : null}
          </View>

          {/* The money, stated plainly: what there is, what the phases promise, what is left. */}
          <View className="gap-2 rounded-card border border-hair bg-raise p-5">
            <SectionLabel>{t('fund.plan.budget.label', locale)}</SectionLabel>
            <Text className="text-[28px] font-extrabold tabular-nums text-aura">
              {formatFundTotal(payable, locale)}
            </Text>
            <Text className="text-[12px] text-muted-foreground">
              {t('fund.plan.allocated', locale, { amt: formatFundTotal(costed, locale) })}
            </Text>
            <Text className="text-[12px] text-muted-foreground">
              {t('fund.plan.remaining', locale, { amt: formatFundTotal(remaining, locale) })}
            </Text>
            <Text className="text-[12px] leading-5 text-muted-foreground">
              {t('fund.plan.budget.hint', locale)}
            </Text>
          </View>

          {proseField(
            t('fund.plan.objective.label', locale),
            t('fund.plan.objective.hint', locale),
            objective,
            setObjective,
          )}
          {proseField(
            t('fund.plan.result.label', locale),
            t('fund.plan.result.hint', locale),
            expectedResult,
            setExpectedResult,
          )}
          {proseField(
            t('fund.plan.professionals.label', locale),
            t('fund.plan.optional', locale),
            professionals,
            setProfessionals,
          )}
          {proseField(
            t('fund.plan.suppliers.label', locale),
            t('fund.plan.optional', locale),
            suppliers,
            setSuppliers,
          )}

          <View className="gap-3">
            <SectionLabel>{t('fund.plan.phases.title', locale)}</SectionLabel>
            <Text className="text-[12px] leading-5 text-muted-foreground">
              {t('fund.plan.phases.hint', locale)}
            </Text>
            {phases.length === 0 ? (
              <Text className="text-[14px] text-muted-foreground">
                {t('fund.plan.phases.empty', locale)}
              </Text>
            ) : (
              phases.map((phase, index) => (
                <PlanPhaseCard
                  key={phase.key}
                  phase={phase}
                  index={index}
                  locale={locale}
                  readOnly={published}
                  onChange={(next) =>
                    setPhases((current) => current.map((p) => (p.key === phase.key ? next : p)))
                  }
                  onRemove={() =>
                    setPhases((current) => current.filter((p) => p.key !== phase.key))
                  }
                />
              ))
            )}
            {!published ? (
              <Button
                label={t('fund.plan.phase.add', locale)}
                onPress={addPhase}
                variant="ghost"
                disabled={busy}
              />
            ) : null}
          </View>

          <Text className="text-[12px] text-muted-foreground">
            {t('fund.plan.zeroAura', locale)}
          </Text>
        </ScrollView>
      </KeyboardAvoiding>
    </Screen>
  );
}
