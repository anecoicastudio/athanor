import { useCallback, useMemo, useRef, useState } from 'react';
import { Alert, type ScrollView as RNScrollView } from 'react-native';
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
import { t } from '@athanor/i18n';
import { ScrollView, Text, View } from '@/tw';
import { Button } from '@/components/Button';
import { ButtonRow } from '@/components/ButtonRow';
import { Card } from '@/components/Card';
import { EmptyState } from '@/components/EmptyState';
import { Field } from '@/components/Field';
import { KeyboardAvoiding } from '@/components/KeyboardAvoiding';
import { LoadingScreen } from '@/components/LoadingScreen';
import { ModalHeader } from '@/components/ModalHeader';
import { RowGroup } from '@/components/RowGroup';
import { Screen } from '@/components/Screen';
import { SectionLabel } from '@/components/SectionLabel';
import { Tag } from '@/components/Tag';
import { PlanPhaseCard, PlanPhaseFacts } from '@/components/fund/PlanPhaseCard';
import { useToast } from '@/components/ToastHost';
import { isDraftDirty } from '@/lib/dirty-guard';
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
import { useDirtyGuard } from '@/hooks/use-dirty-guard';
import { useLocale } from '@/hooks/use-locale';

/** The plan's four prose fields, as the draft carries them. */
type ProseDraft = {
  objective: string;
  expectedResult: string;
  professionals: string;
  suppliers: string;
};

const EMPTY_PROSE: ProseDraft = {
  objective: '',
  expectedResult: '',
  professionals: '',
  suppliers: '',
};

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
 *
 * The look (Galleria, Marco 2026-10-09, #921): blocks 26 apart on the stage. The budget is
 * the screen's one bordered card, its figure the middle numeral in foreground. A draft phase
 * is a fold (`fund/PlanPhaseCard`); a published plan lists its phases as blocks of one group
 * and its four prose fields as text. Nothing here is cyan: planning money is not one of the
 * five marks (DESIGN §2.3).
 */
export default function RealizationPlanScreen() {
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
  //
  // The server row IS the draft until the member types. That used to be two effects copying it
  // into eight `useState`s behind two `hydrated` flags (#691); it is a fallback now. The three
  // properties those flags were protecting all survive, and two of them get stronger:
  //
  // - a background refetch cannot overwrite what the member is writing — once `edit` is set it
  //   wins outright, so there is no window in which a late row lands on top of a keystroke;
  // - an empty phase list stays empty. It is a legitimate draft state (the member removed the
  //   last phase) and nothing re-derives it, so it cannot be resurrected;
  // - the #636 baseline is still captured at the moment editing STARTS — it rides along in the
  //   same state — so a loaded plan does not read as edited before it is touched, and a refetch
  //   mid-edit cannot move the mark the guard measures against.
  const serverProse: ProseDraft = plan
    ? {
        objective: plan.objective,
        expectedResult: plan.expected_result,
        professionals: plan.professionals,
        suppliers: plan.suppliers,
      }
    : EMPTY_PROSE;
  const [proseEdit, setProseEdit] = useState<{
    values: ProseDraft;
    baseline: ProseDraft;
  } | null>(null);
  const { objective, expectedResult, professionals, suppliers } = proseEdit?.values ?? serverProse;
  const proseBaseline = proseEdit?.baseline ?? serverProse;
  const editProse = (patch: Partial<ProseDraft>) =>
    setProseEdit((edit) => ({
      values: { ...(edit?.values ?? serverProse), ...patch },
      baseline: edit?.baseline ?? serverProse,
    }));
  const setObjective = (v: string) => editProse({ objective: v });
  const setExpectedResult = (v: string) => editProse({ expectedResult: v });
  const setProfessionals = (v: string) => editProse({ professionals: v });
  const setSuppliers = (v: string) => editProse({ suppliers: v });

  const serverDraftPhases = draftFromPhases(serverPhases);
  const [phasesEdit, setPhasesEdit] = useState<{
    values: DraftPhase[];
    baseline: DraftPhase[];
  } | null>(null);
  const phases = phasesEdit?.values ?? serverDraftPhases;
  const phasesBaseline = phasesEdit?.baseline ?? serverDraftPhases;
  const setPhases = (next: DraftPhase[] | ((current: DraftPhase[]) => DraftPhase[])) =>
    setPhasesEdit((edit) => {
      const current = edit?.values ?? serverDraftPhases;
      return {
        values: typeof next === 'function' ? next(current) : next,
        baseline: edit?.baseline ?? serverDraftPhases,
      };
    });

  const payable = payableCents(edition?.confirmed_pool_cents ?? 0, edition?.split_pct ?? 0);
  const costed = costedCents(phases);
  const remaining = remainingPayableCents(
    edition?.confirmed_pool_cents ?? 0,
    edition?.split_pct ?? 0,
    costed,
  );

  const proseComplete = objective.trim().length > 0 && expectedResult.trim().length > 0;

  // Which folds are open, by the phase's key (Marco, 2026-10-09): none at rest, any number at
  // once. A phase the member just added opens, and so does one a refused save found unfinished.
  // A saved phase takes its row's id as its key, so the fold of a new phase shuts on save.
  const [openKeys, setOpenKeys] = useState<ReadonlySet<string>>(() => new Set());
  const togglePhase = (key: string) =>
    setOpenKeys((keys) => {
      const next = new Set(keys);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  // Where each fold starts in the scroll's content, as laid out: a refused save scrolls to one.
  // A shut fold is opened first and scrolled to once it has been laid out open (`pendingReveal`):
  // scrolled to while still shut, the last fold stopped at the foot of the shorter list (iPhone
  // SE simulator, Expo Go, 2026-10-09).
  const scroller = useRef<RNScrollView>(null);
  const phaseTops = useRef<Record<string, number>>({});
  const pendingReveal = useRef<string | null>(null);
  // A cut and not a glide (§10). Every fold stands below the budget and the four prose fields,
  // so `top - 12` is never negative.
  const revealPhase = useCallback((key: string) => {
    const top = phaseTops.current[key];
    if (top !== undefined) scroller.current?.scrollTo({ y: top - 12, animated: false });
  }, []);

  // Monotonic, never derived from the list. A key computed from the current phases can be
  // handed out twice — remove one of two new phases and the next add recomputes the key the
  // survivor still holds, which React reads as the same row.
  const nextPhaseKey = useRef(0);

  // No `useCallback`: `setPhases` is a plain function now rather than a `useState` setter, so a
  // manual memo would have to list it and re-make itself every render anyway. Its only call site
  // is an `onPress`, and the compiler memoizes what is worth memoizing.
  const addPhase = () => {
    // A local key that is not an id: this phase has no row yet.
    const key = `new-${nextPhaseKey.current++}`;
    setOpenKeys((keys) => new Set(keys).add(key));
    setPhases((current) => [
      ...current,
      {
        key,
        id: null,
        title: '',
        scheduledFor: dayKey(new Date().toISOString()),
        amountCents: null,
        criteria: '',
      },
    ]);
  };

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
    const unfinished = phases.find((p) => !phaseComplete(p));
    if (unfinished) {
      showToast(t('fund.plan.error.phaseIncomplete', locale));
      // The toast says what a phase needs; a shut fold would not say which one. Open it and
      // bring its row to the top of the list.
      if (openKeys.has(unfinished.key)) {
        revealPhase(unfinished.key);
      } else {
        pendingReveal.current = unfinished.key;
        setOpenKeys((keys) => new Set(keys).add(unfinished.key));
      }
      return;
    }
    saveMutation.mutate();
  }, [proseComplete, phases, openKeys, revealPhase, locale, showToast, saveMutation]);

  const onPublish = useCallback(() => {
    Alert.alert(t('fund.plan.publish.title', locale), t('fund.plan.publish.body', locale), [
      { text: t('common.cancel', locale), style: 'cancel' },
      { text: t('fund.plan.publish.cta', locale), onPress: () => publishMutation.mutate() },
    ]);
  }, [locale, publishMutation]);

  const header = (
    <ModalHeader title={t('fund.plan.title', locale)} backLabel={t('common.back', locale)} />
  );

  const busy = saveMutation.isPending || publishMutation.isPending;
  // No "has it hydrated yet" arm: an untouched draft IS its own baseline, so a load — with a
  // row or without one — compares equal. Unpublished prose and phase edits are the work at risk.
  useDirtyGuard({
    dirty:
      isDraftDirty(proseBaseline, { objective, expectedResult, professionals, suppliers }) ||
      isDraftDirty(phasesBaseline, phases),
    saving: busy,
  });

  if (editionQuery.isLoading || myCandidacyQuery.isLoading || planQuery.isLoading) {
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

  // A label 6 above its field and the hint 6 under it. Once the plan is published the field is
  // its text, and the hint — an instruction to whoever is writing — has nobody left to address.
  const proseField = (
    label: string,
    hint: string,
    value: string,
    onChangeText: (v: string) => void,
  ) => (
    <View className="gap-1.5">
      <SectionLabel>{label}</SectionLabel>
      {published ? (
        <Text className="type-body text-foreground">{value || '—'}</Text>
      ) : (
        <>
          <Field multiline accessibilityLabel={label} value={value} onChangeText={onChangeText} />
          <Text className="type-small text-muted-foreground">{hint}</Text>
        </>
      )}
    </View>
  );

  return (
    <Screen
      footer={
        published ? undefined : (
          // Two pills side by side under a hairline, as the profile's footer has them: saving
          // the draft is the white pill and publishing the outline beside it (DESIGN §9). The
          // row wraps when the two do not fit (§10).
          <ButtonRow className="border-t border-hair px-5 pb-3 pt-3">
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
                variant="outline"
                disabled={busy}
              />
            ) : null}
          </ButtonRow>
        )
      }
    >
      {header}
      <KeyboardAvoiding>
        <ScrollView
          ref={scroller}
          className="flex-1"
          contentContainerClassName="gap-[26px] px-5 pb-12"
        >
          <Text className="type-small text-muted-foreground">{t('fund.plan.lead', locale)}</Text>

          {/* Whose eyes the plan is for, as a tag: a draft only its author sees, or the day it
              went public and the one sentence about what that means. */}
          <View className="items-start gap-2">
            <Tag
              label={
                published
                  ? t('fund.plan.published', locale, {
                      date: calendarDay(dayKey(plan.published_at as string), locale),
                    })
                  : t('fund.plan.draft', locale)
              }
            />
            {published ? (
              <Text className="type-small text-muted-foreground">
                {t('fund.plan.publishedNote', locale)}
              </Text>
            ) : null}
          </View>

          {/* The money, stated plainly: what there is, what the phases promise, what is left.
              The two sums stand on a line each: side by side they do not fit the card. */}
          <Card>
            <SectionLabel>{t('fund.plan.budget.label', locale)}</SectionLabel>
            <Text className="type-num-m text-foreground">{formatFundTotal(payable, locale)}</Text>
            <View>
              <Text className="type-small text-muted-foreground">
                {t('fund.plan.allocated', locale, { amt: formatFundTotal(costed, locale) })}
              </Text>
              <Text className="type-small text-muted-foreground">
                {t('fund.plan.remaining', locale, { amt: formatFundTotal(remaining, locale) })}
              </Text>
            </View>
            <Text className="type-small text-muted-foreground">
              {t('fund.plan.budget.hint', locale)}
            </Text>
          </Card>

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

          <View className="gap-2">
            <SectionLabel>{t('fund.plan.phases.title', locale)}</SectionLabel>
            <Text className="type-small text-muted-foreground">
              {t('fund.plan.phases.hint', locale)}
            </Text>
            {phases.length === 0 ? (
              <Text className="type-small text-muted-foreground">
                {t('fund.plan.phases.empty', locale)}
              </Text>
            ) : null}
          </View>

          {published ? (
            phases.length > 0 ? (
              <RowGroup>
                {phases.map((phase, index) => (
                  <PlanPhaseFacts key={phase.key} phase={phase} index={index} locale={locale} />
                ))}
              </RowGroup>
            ) : null
          ) : (
            phases.map((phase, index) => (
              // Each fold is a block of the screen, 26 from the next. The wrapper is there to
              // be measured: its `y` is where a refused save scrolls to.
              <View
                key={phase.key}
                onLayout={(e) => {
                  phaseTops.current[phase.key] = e.nativeEvent.layout.y;
                  if (pendingReveal.current === phase.key) {
                    pendingReveal.current = null;
                    revealPhase(phase.key);
                  }
                }}
              >
                <PlanPhaseCard
                  phase={phase}
                  index={index}
                  locale={locale}
                  open={openKeys.has(phase.key)}
                  onToggle={() => togglePhase(phase.key)}
                  onChange={(next) =>
                    setPhases((current) => current.map((p) => (p.key === phase.key ? next : p)))
                  }
                  onRemove={() =>
                    setPhases((current) => current.filter((p) => p.key !== phase.key))
                  }
                />
              </View>
            ))
          )}

          {!published ? (
            <Button
              label={t('fund.plan.phase.add', locale)}
              onPress={addPhase}
              variant="outline"
              disabled={busy}
            />
          ) : null}

          <Text className="type-small text-muted-foreground">
            {t('fund.plan.zeroAura', locale)}
          </Text>
        </ScrollView>
      </KeyboardAvoiding>
    </Screen>
  );
}
