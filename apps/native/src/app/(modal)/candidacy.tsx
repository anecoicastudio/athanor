import { useMemo, useState } from 'react';
import { ActivityIndicator } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  candidacyKeys,
  dreamKeys,
  fundKeys,
  getActiveDream,
  getActiveEdition,
  getMyCandidacy,
  submitCandidacy,
  updateCandidacy,
} from '@athanor/api';
import { MAX_SKILLS, SKILLS } from '@athanor/core';
import { semantic } from '@athanor/config';
import {
  type DreamCandidacy,
  type FundEdition,
  type ProjectCategory,
  projectCategorySchema,
} from '@athanor/schemas';
import { t, type MessageKey } from '@athanor/i18n';
import { Pressable, ScrollView, Text, TextInput, View } from '@/tw';
import { Button } from '@/components/Button';
import { Chip } from '@/components/Chip';
import { DreamQuote } from '@/components/DreamQuote';
import { SectionLabel } from '@/components/SectionLabel';
import { StepDots } from '@/components/StepDots';
import { VideoUploadTile } from '@/components/candidacy/VideoUploadTile';
import { useToast } from '@/components/ToastHost';
import { useCandidacyUpload } from '@/lib/media/use-candidacy-upload';
import { useAuth } from '@/lib/auth-context';
import { supabase } from '@/lib/supabase';
import { Screen } from '@/components/Screen';

const TOTAL_STEPS = 7;

/**
 * 7-step candidacy wizard (07 §3.4; #226 added steps 6–7).
 * Steps: 1 story / 2 goal / 3 impact / 4 video / 5 plan + budget / 6 skills / 7 category + dream.
 * Steps 6–7 are optional — an empty declaration is first-class and can never block a submit.
 * Gated by identity_verified (real gate — M9 wires the Stripe Identity webhook).
 * Window-closed guard: if no open edition or candidacy_window_open=false → empty-state.
 * No Aura is awarded for candidacy (rule #1, asserted in pgTAP).
 *
 * Step 5 collects budget_cents + min_viable_cents beside the plan (#225 made them NOT NULL,
 * so a payload without them cannot insert). The minimum is BALLOT INFORMATION, not the
 * shortfall gate (FUND-42 is).
 *
 * `?edit=1` is the EXPLICIT resubmission path (#226): the member's existing row prefills the
 * form and submit becomes updateCandidacy. It is never entered automatically — annual.tsx
 * offers it only while the row is still 'submitted' (the RLS update window,
 * dream_candidacies_update_own_submitted) and the candidacy window is open.
 */
export default function CandidacyWizard() {
  const router = useRouter();
  const { profile } = useAuth();
  const locale = profile?.locale ?? 'it';
  const uid = profile?.id ?? '';
  const { edit } = useLocalSearchParams<{ edit?: string }>();
  const editing = edit === '1';

  const editionQuery = useQuery({
    queryKey: fundKeys.activeEdition(),
    queryFn: () => getActiveEdition(supabase),
  });
  const edition = editionQuery.data ?? null;

  // Edit mode only: the row that prefills the form. Never fetched on a fresh submit.
  const mineQuery = useQuery({
    queryKey: candidacyKeys.mine(edition?.id ?? ''),
    queryFn: () => getMyCandidacy(supabase, edition!.id, uid),
    enabled: editing && !!edition && uid !== '',
  });

  const windowClosed = editionQuery.isSuccess && (!edition || !edition.candidacy_window_open);

  // window-closed: no open edition or window shut → empty-state instead of the wizard.
  if (windowClosed) {
    return (
      <Screen className="items-center justify-center px-8">
        <Text className="text-center text-[15px] text-muted-foreground">
          {t('candidacy.windowClosed', locale)}
        </Text>
        <View className="mt-6 w-full">
          <Button variant="ghost" label={t('common.back', locale)} onPress={() => router.back()} />
        </View>
      </Screen>
    );
  }

  if (editing && mineQuery.isError) {
    return (
      <Screen className="items-center justify-center px-8">
        <Text className="text-center text-[15px] text-muted-foreground">
          {t('fund.error', locale)}
        </Text>
        <View className="mt-6 w-full">
          <Button
            variant="ghost"
            label={t('common.retry', locale)}
            onPress={() => void mineQuery.refetch()}
          />
        </View>
      </Screen>
    );
  }

  // Edit mode waits for the row so the form MOUNTS prefilled — state initializers, no
  // prefill effects racing the member's typing.
  if (editing && mineQuery.data === undefined) {
    return (
      <Screen className="items-center justify-center">
        <ActivityIndicator color={semantic.aura} />
      </Screen>
    );
  }

  return <WizardForm initial={editing ? (mineQuery.data ?? null) : null} edition={edition} />;
}

function WizardForm({
  initial,
  edition,
}: {
  initial: DreamCandidacy | null;
  edition: FundEdition | null;
}) {
  const router = useRouter();
  const qc = useQueryClient();
  const { showToast } = useToast();
  const { profile } = useAuth();
  const locale = profile?.locale ?? 'it';
  const uid = profile?.id ?? '';

  const [step, setStep] = useState(0); // 0–6 (displayed as steps 1–7)
  const [story, setStory] = useState(initial?.story ?? '');
  const [goal, setGoal] = useState(initial?.goal ?? '');
  const [impact, setImpact] = useState(initial?.impact ?? '');
  const [planText, setPlanText] = useState(initial?.plan ?? '');
  const [budgetEuro, setBudgetEuro] = useState(
    initial ? String(Math.round(initial.budget_cents / 100)) : '',
  );
  const [minViableEuro, setMinViableEuro] = useState(
    initial ? String(Math.round(initial.min_viable_cents / 100)) : '',
  );
  const [skills, setSkills] = useState<string[]>(initial?.skills_needed ?? []);
  const [category, setCategory] = useState<ProjectCategory | null>(initial?.category ?? null);
  const [linkDream, setLinkDream] = useState(Boolean(initial?.dream_id));
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Edit mode passes the existing id so a replacement video overwrites the same storage key.
  const upload = useCandidacyUpload(uid, initial?.id);

  // The author's single active dream — the only dream the wizard offers to link (D12);
  // RLS re-checks ownership server-side either way.
  const dreamQuery = useQuery({
    queryKey: dreamKeys.byProfile(uid),
    queryFn: () => getActiveDream(supabase, uid),
    enabled: uid !== '',
  });
  const activeDream = dreamQuery.data ?? null;

  // Whole euros typed by the member → integral cents; null when not a plain positive integer.
  const euroToCents = (v: string): number | null =>
    /^\d+$/.test(v.trim()) && Number(v.trim()) > 0 ? Number(v.trim()) * 100 : null;
  const budgetCents = euroToCents(budgetEuro);
  const minViableCents = euroToCents(minViableEuro);
  const budgetValid =
    budgetCents !== null && minViableCents !== null && minViableCents <= budgetCents;

  // Edit mode: the stored video stands until a replacement finishes uploading.
  const hasVideo = upload.status === 'done' || (initial !== null && upload.status !== 'uploading');

  // Whether the user can advance from the current step.
  const canAdvance = useMemo(() => {
    if (step === 3) return hasVideo; // video required to leave step 4
    if (step === 4) return planText.trim().length > 0 && budgetValid;
    if (step >= 5) return true; // skills / category / dream are optional (#226) — never blocking
    const fieldForStep = [story, goal, impact];
    const val = fieldForStep[step];
    return val !== undefined && val.trim().length > 0;
  }, [step, story, goal, impact, planText, budgetValid, hasVideo]);

  const toggleSkill = (key: string) =>
    setSkills((prev) =>
      prev.includes(key)
        ? prev.filter((x) => x !== key)
        : prev.length >= MAX_SKILLS
          ? prev
          : [...prev, key],
    );

  const advance = () => {
    if (!canAdvance) {
      setError(
        step === 3 ? t('candidacy.error.video', locale) : t('candidacy.error.empty', locale),
      );
      return;
    }
    setError(null);
    setStep((s) => s + 1);
  };

  const onSubmit = async () => {
    // Steps 6–7 never gate, so re-check the step-5 invariants here.
    if (planText.trim().length === 0 || !budgetValid) {
      setError(
        planText.trim().length > 0 && !budgetValid
          ? t('candidacy.error.budget', locale)
          : t('candidacy.error.empty', locale),
      );
      return;
    }
    // id-gate: real precondition — M9 Stripe Identity webhook sets identity_verified.
    if (!profile?.identity_verified) {
      setError(t('candidacy.idGate', locale));
      return;
    }
    const videoPath = upload.videoPath ?? initial?.video_url ?? null;
    if (!edition || !videoPath || budgetCents === null || minViableCents === null) return;
    // A replaced video invalidates the stored poster; an untouched one keeps it.
    const thumbPath = upload.videoPath ? upload.thumbPath : (initial?.thumb_path ?? null);
    const dreamId = linkDream ? (initial?.dream_id ?? activeDream?.id ?? null) : null;
    setSubmitting(true);
    try {
      if (initial) {
        await updateCandidacy(supabase, initial.id, {
          story: story.trim(),
          goal: goal.trim(),
          impact: impact.trim(),
          video_url: videoPath,
          thumb_path: thumbPath,
          plan: planText.trim(),
          budget_cents: budgetCents,
          min_viable_cents: minViableCents,
          skills_needed: skills,
          category,
          dream_id: dreamId,
        });
        void qc.invalidateQueries({ queryKey: candidacyKeys.all });
        showToast(t('candidacy.edit.toast', locale), 'success');
        router.back();
      } else {
        await submitCandidacy(supabase, {
          id: upload.candidacyId,
          profileId: uid,
          input: {
            edition_id: edition.id,
            story: story.trim(),
            goal: goal.trim(),
            impact: impact.trim(),
            video_url: videoPath,
            thumb_path: thumbPath,
            plan: planText.trim(),
            budget_cents: budgetCents,
            min_viable_cents: minViableCents,
            skills_needed: skills,
            category,
            dream_id: dreamId,
          },
        });
        void qc.invalidateQueries({ queryKey: candidacyKeys.all });
        router.replace('/(modal)/candidacy-success');
      }
    } catch {
      setError(t(initial ? 'candidacy.error.update' : 'candidacy.error.submit', locale));
      setSubmitting(false);
    }
  };

  const isLast = step === TOTAL_STEPS - 1;
  // Build the step-scoped i18n key (e.g. 'candidacy.step1.q').
  const stepNum = (step + 1) as 1 | 2 | 3 | 4 | 5 | 6 | 7;
  const stepKey = (part: string) => `candidacy.step${stepNum}.${part}` as MessageKey;

  return (
    <Screen>
      <ScrollView
        className="flex-1"
        contentContainerClassName="grow px-5 pb-9 pt-4"
        keyboardShouldPersistTaps="handled"
      >
        {/* Header: back chevron + eyebrow */}
        <View className="flex-row items-center gap-3">
          {/* Real 44pt tap target (DESIGN §10, #164) — was a bare glyph + hitSlop ≈38pt
            wide. -ml-3 keeps the glyph optically near the gutter. */}
          <Pressable
            onPress={() => (step > 0 ? setStep((s) => s - 1) : router.back())}
            className="-ml-3 h-11 w-11 items-center justify-center"
            accessibilityRole="button"
            accessibilityLabel={t('common.back', locale)}
          >
            <Text className="text-2xl text-foreground">‹</Text>
          </Pressable>
          <SectionLabel tone="aura" numberOfLines={1} className="shrink">
            {t('candidacy.eyebrow', locale)}
          </SectionLabel>
        </View>

        {/* Step dots (7 dots, current and past filled cyan) */}
        <View className="mt-3">
          <StepDots count={TOTAL_STEPS} current={step} />
        </View>

        {/* Step content — vertically centred */}
        <View className="grow justify-center">
          <SectionLabel>{t(stepKey('label'), locale)}</SectionLabel>
          <Text className="mt-3 text-[25px] font-bold tracking-[-0.02em] text-foreground">
            {t(stepKey('q'), locale)}
          </Text>
          <Text className="mt-2 text-muted-foreground">{t(stepKey('sub'), locale)}</Text>

          <View className="mt-5">
            {step === 0 ? (
              <TextInput
                className="min-h-32 rounded-hero border border-hair bg-raise px-5 py-4 font-dream text-lg text-foreground"
                multiline
                maxLength={4000}
                placeholder={t('candidacy.step1.placeholder', locale)}
                value={story}
                onChangeText={(v) => {
                  setStory(v);
                  setError(null);
                }}
              />
            ) : null}
            {step === 1 ? (
              <TextInput
                className="min-h-32 rounded-hero border border-hair bg-raise px-5 py-4 font-dream text-lg text-foreground"
                multiline
                maxLength={2000}
                placeholder={t('candidacy.step2.placeholder', locale)}
                value={goal}
                onChangeText={(v) => {
                  setGoal(v);
                  setError(null);
                }}
              />
            ) : null}
            {step === 2 ? (
              <TextInput
                className="min-h-32 rounded-hero border border-hair bg-raise px-5 py-4 font-dream text-lg text-foreground"
                multiline
                maxLength={2000}
                placeholder={t('candidacy.step3.placeholder', locale)}
                value={impact}
                onChangeText={(v) => {
                  setImpact(v);
                  setError(null);
                }}
              />
            ) : null}
            {step === 3 ? (
              <View className="gap-3">
                <VideoUploadTile
                  locale={locale}
                  status={upload.status}
                  progress={upload.progress}
                  onPick={upload.pick}
                  onRecord={upload.record}
                  onCancel={upload.cancel}
                />
                {/* Edit mode: the stored video stands unless a replacement lands. */}
                {initial && upload.status !== 'done' ? (
                  <Text className="text-[12px] leading-[18px] text-faint">
                    {t('candidacy.step4.keepHint', locale)}
                  </Text>
                ) : null}
              </View>
            ) : null}
            {step === 4 ? (
              <View className="gap-4">
                <TextInput
                  className="min-h-32 rounded-hero border border-hair bg-raise px-5 py-4 font-dream text-lg text-foreground"
                  multiline
                  maxLength={4000}
                  placeholder={t('candidacy.step5.placeholder', locale)}
                  value={planText}
                  onChangeText={(v) => {
                    setPlanText(v);
                    setError(null);
                  }}
                />
                {/* Budget + minimum viable (#225): whole euros; the minimum informs the
                    ballot, it is not the shortfall gate (FUND-42 is). */}
                <View className="flex-row gap-3">
                  <View className="flex-1 gap-1.5">
                    <SectionLabel>{t('candidacy.budget.label', locale)}</SectionLabel>
                    <TextInput
                      className="rounded-hero border border-hair bg-raise px-5 py-4 text-lg text-foreground"
                      keyboardType="number-pad"
                      maxLength={9}
                      placeholder="8000"
                      value={budgetEuro}
                      onChangeText={(v) => {
                        setBudgetEuro(v);
                        setError(null);
                      }}
                    />
                  </View>
                  <View className="flex-1 gap-1.5">
                    <SectionLabel>{t('candidacy.budget.min.label', locale)}</SectionLabel>
                    <TextInput
                      className="rounded-hero border border-hair bg-raise px-5 py-4 text-lg text-foreground"
                      keyboardType="number-pad"
                      maxLength={9}
                      placeholder="5000"
                      value={minViableEuro}
                      onChangeText={(v) => {
                        setMinViableEuro(v);
                        setError(null);
                      }}
                    />
                  </View>
                </View>
                <Text className="text-[12px] leading-[18px] text-faint">
                  {t('candidacy.budget.hint', locale)}
                </Text>
              </View>
            ) : null}
            {step === 5 ? (
              // Skills the dream needs (#226, FUND-10) — curated keys, ≤ MAX_SKILLS, optional.
              <View className="flex-row flex-wrap gap-3">
                {SKILLS.map((key) => (
                  <Chip
                    key={key}
                    label={t(`tag.skill.${key}` as MessageKey, locale)}
                    selected={skills.includes(key)}
                    onPress={() => toggleSkill(key)}
                  />
                ))}
              </View>
            ) : null}
            {step === 6 ? (
              <View className="gap-6">
                {/* Category (#226, D43) — tapping the selected chip clears it: «no
                    category» stays first-class. */}
                <View className="gap-3">
                  <SectionLabel>{t('candidacy.category.label', locale)}</SectionLabel>
                  <View className="flex-row flex-wrap gap-3">
                    {projectCategorySchema.options.map((key) => (
                      <Chip
                        key={key}
                        label={t(`costellazioni.filter.${key}` as MessageKey, locale)}
                        selected={category === key}
                        onPress={() => setCategory(category === key ? null : key)}
                      />
                    ))}
                  </View>
                </View>
                {/* Optional link to the author's own personal dream (#226, D12/FUND-50). */}
                <View className="gap-3">
                  <SectionLabel>{t('candidacy.dream.label', locale)}</SectionLabel>
                  {activeDream || initial?.dream_id ? (
                    <View className="gap-3">
                      <View className="flex-row flex-wrap gap-3">
                        <Chip
                          label={t('candidacy.dream.link', locale)}
                          selected={linkDream}
                          onPress={() => setLinkDream((v) => !v)}
                        />
                      </View>
                      {activeDream ? (
                        <DreamQuote text={activeDream.text} compact numberOfLines={2} />
                      ) : null}
                    </View>
                  ) : (
                    <Text className="text-[13px] text-muted-foreground">
                      {t('candidacy.dream.none', locale)}
                    </Text>
                  )}
                </View>
              </View>
            ) : null}
          </View>

          {/* Error caption */}
          {error ? <Text className="mt-3 text-[13px] text-error">{error}</Text> : null}

          {/* id-gate CTA stub (last step only, unverified identity) */}
          {isLast && !profile?.identity_verified ? (
            <Pressable
              className="mt-4"
              onPress={() => router.push('/(modal)/verify')}
              accessibilityRole="button"
            >
              <Text className="text-[13px] font-semibold text-aura">
                {t('candidacy.idGate.cta', locale)}
              </Text>
            </Pressable>
          ) : null}
        </View>

        {/* Footer: primary CTA + legal note */}
        <View className="mt-6 gap-3">
          <Button
            variant="light"
            label={
              isLast
                ? t(initial ? 'candidacy.edit.submit' : 'candidacy.submit', locale)
                : t('candidacy.continue', locale)
            }
            disabled={submitting || upload.status === 'uploading'}
            onPress={isLast ? () => void onSubmit() : advance}
          />
          <Text className="text-center text-[12px] leading-[18px] text-faint">
            {t('candidacy.legal', locale)}
          </Text>
        </View>
      </ScrollView>
    </Screen>
  );
}
