import { useCallback, useState } from 'react';
import { ActivityIndicator } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  candidacyKeys,
  getMyCandidacy,
  getMyLatestPriorCandidacy,
  submitCandidacy,
  updateCandidacy,
} from '@athanor/api';
import { MAX_SKILLS, SKILLS, canSubmitCandidacy } from '@athanor/core';
import { semantic } from '@athanor/config';
import { type DreamCandidacy, type FundEdition, projectCategorySchema } from '@athanor/schemas';
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
import { useSignedUrls } from '@/lib/media/use-signed-urls';
import {
  TOTAL_STEPS,
  type WizardDraft,
  type WizardTextField,
  type WizardValues,
  budgetPair,
  hasStandingVideo,
  prefillValues,
  standingVideo,
  stepAt,
  stepBlocker,
  submitBlockers,
} from '@/lib/candidacy-wizard';
import { useAuth } from '@/lib/auth-context';
import { supabase } from '@/lib/supabase';
import { Screen } from '@/components/Screen';
import { useActiveDream } from '@/hooks/use-active-dream';
import { useActiveEdition } from '@/hooks/use-active-edition';

/**
 * 7-step candidacy wizard (07 §3.4; #226 added steps 6–7).
 * Steps: 1 story / 2 goal / 3 impact / 4 video / 5 plan + budget / 6 skills / 7 category + dream.
 * Steps 6–7 are optional — an empty declaration is first-class and can never block a submit.
 *
 * The steps themselves, their catalog keys and every gating rule live in
 * `@/lib/candidacy-wizard` (#385) — this file mounts them. Adding a step is one entry there.
 * Gated by identity_verified (real gate — M9 wires the Stripe Identity webhook). The gate is
 * stated twice on purpose (#412): on step 4, because the candidacy-videos insert policy refuses
 * the blob without it, and at submit, because the row INSERT refuses too.
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
 *
 * `?resubmit=1` is FUND-35's cross-cycle half (#221): the member's most recent candidacy
 * from a closed prior cycle prefills the TEXT of a fresh submit — a prior-cycle row is
 * terminal ('voided'/'rejected'/'winner'), so submit stays submitCandidacy and a new video
 * is required (the old object belongs to the old candidacy's storage key). Explicit here
 * too: annual.tsx offers it only when no current-cycle candidacy exists.
 */
export default function CandidacyWizard() {
  const router = useRouter();
  const { profile } = useAuth();
  const locale = profile?.locale ?? 'it';
  const uid = profile?.id ?? '';
  const { edit, resubmit } = useLocalSearchParams<{ edit?: string; resubmit?: string }>();
  const editing = edit === '1';
  const resubmitting = !editing && resubmit === '1';

  const editionQuery = useActiveEdition();
  const edition = editionQuery.data ?? null;

  // Edit/resubmit mode only: the row that prefills the form. Never fetched on a fresh
  // submit. Edit reads the current cycle's own row; resubmit the latest prior-cycle one.
  const mineQuery = useQuery({
    queryKey: editing
      ? candidacyKeys.mine(edition?.id ?? '')
      : candidacyKeys.priorMine(edition?.id ?? ''),
    queryFn: () =>
      editing
        ? getMyCandidacy(supabase, edition!.id, uid)
        : getMyLatestPriorCandidacy(supabase, edition!.id, uid),
    enabled: (editing || resubmitting) && !!edition && uid !== '',
  });

  // The rule is `canSubmitCandidacy` (`@athanor/core`), which mirrors `public.fund_edition_open()`
  // — the flag AND `phase <> 'closed'`. This read used to check the flag alone (#382), so a closed
  // cycle whose window flag was never lowered offered the wizard over a storage policy and an
  // INSERT that both refuse. `isSuccess` still gates the claim: an unsettled read is not a shut
  // window (#111).
  const windowClosed = editionQuery.isSuccess && (!edition || !canSubmitCandidacy(edition));

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

  if ((editing || resubmitting) && mineQuery.isError) {
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

  // Edit/resubmit mode waits for the row so the form MOUNTS prefilled — state
  // initializers, no prefill effects racing the member's typing.
  if ((editing || resubmitting) && mineQuery.data === undefined) {
    return (
      <Screen className="items-center justify-center">
        <ActivityIndicator color={semantic.aura} />
      </Screen>
    );
  }

  // A resubmit deep link with no prior row degrades to the plain fresh wizard.
  return (
    <WizardForm
      initial={editing || resubmitting ? (mineQuery.data ?? null) : null}
      mode={editing ? 'edit' : 'fresh'}
      edition={edition}
    />
  );
}

function WizardForm({
  initial,
  mode,
  edition,
}: {
  initial: DreamCandidacy | null;
  /** 'edit' = same-cycle update (#226); 'fresh' = new row, prefilled when `initial` is a
   *  prior-cycle candidacy (#221) — the video never stands on a fresh submit. */
  mode: 'edit' | 'fresh';
  edition: FundEdition | null;
}) {
  const router = useRouter();
  const qc = useQueryClient();
  const { showToast } = useToast();
  const { profile, refreshProfile } = useAuth();
  const locale = profile?.locale ?? 'it';
  const uid = profile?.id ?? '';

  // Re-read the profile on focus while unverified (#412). The verify sheet refreshes it when
  // the flag flips while that screen is mounted, but the Stripe webhook can land after the
  // member has already closed it — and step 4's upload buttons now refuse on this flag, so a
  // profile that never re-reads would turn a recoverable gate into a permanently dead button.
  useFocusEffect(
    useCallback(() => {
      if (!profile?.identity_verified) void refreshProfile();
    }, [profile?.identity_verified, refreshProfile]),
  );

  const [step, setStep] = useState(0); // 0–6 (displayed as steps 1–7)
  // One object rather than nine states: `prefillValues` is then the whole prefill path, and
  // both #226's edit and #221's cross-cycle resubmit mount already filled — state
  // initialisers, no prefill effects racing the member's typing.
  const [values, setValues] = useState<WizardValues>(() => prefillValues(initial));
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Typing anywhere clears the error caption; tapping a chip on the optional steps does not,
  // because those steps never raise one.
  const setText = (field: WizardTextField, value: string) => {
    setValues((prev) => ({ ...prev, [field]: value }));
    setError(null);
  };

  // Edit mode passes the existing id so a replacement video overwrites the same storage
  // key. A prefilled fresh submit (#221) gets a NEW id: the row is new and the prior
  // cycle's video object stays under the old candidacy's key, untouched.
  const upload = useCandidacyUpload(uid, {
    // The same precondition Storage enforces on the blob (#412) — checked here so the refusal
    // costs a tap, not a recording plus a whole upload.
    identityVerified: profile?.identity_verified ?? false,
    existingId: mode === 'edit' ? initial?.id : undefined,
  });

  // The author's single active dream — the only dream the wizard offers to link (D12);
  // RLS re-checks ownership server-side either way.
  const dreamQuery = useActiveDream(uid);
  const activeDream = dreamQuery.data ?? null;

  // Whole euros typed by the member → integral cents, or null unless the pair is usable.
  // The screen submits exactly what the gate accepted (#385); the integer-only parser it
  // wraps lives in @athanor/core (#387), because «numeri interi» is a copy contract.
  const budget = budgetPair(values);

  const hasVideo = hasStandingVideo({
    uploadStatus: upload.status,
    mode,
    hasInitial: initial !== null,
  });

  // Edit mode opens on a video that already stands, so step 4 draws its stored poster instead of
  // the «nothing picked» glyph (#463). Same signer and bucket as the ballot (`annual.tsx`), and
  // the same rule as the submit path below: the poster stands only in edit mode. A posterless
  // row signs nothing — the query is disabled on an empty list and `isLoading` stays false.
  const standing = standingVideo({ mode, initial });
  const { urls: standingUrls, isLoading: isLoadingStandingPoster } = useSignedUrls(
    'candidacy-videos',
    standing?.thumbPath ? [standing.thumbPath] : [],
  );

  // What every gate reads: the typed values plus the one fact that is not typed.
  const draft: WizardDraft = { ...values, hasVideo };

  const toggleSkill = (key: string) =>
    setValues((prev) =>
      prev.skills.includes(key)
        ? { ...prev, skills: prev.skills.filter((x) => x !== key) }
        : prev.skills.length >= MAX_SKILLS
          ? prev
          : { ...prev, skills: [...prev.skills, key] },
    );

  const advance = () => {
    const blocker = stepBlocker(draft, step);
    if (blocker) {
      setError(t(blocker, locale));
      return;
    }
    setError(null);
    setStep((s) => s + 1);
  };

  const onSubmit = async () => {
    // Steps 6–7 never gate, so the button re-runs every step's own validator — the same
    // rules, not a second hand-written copy of them.
    const [blocker] = submitBlockers(draft);
    if (blocker) {
      setError(t(blocker, locale));
      return;
    }
    // id-gate: real precondition — M9 Stripe Identity webhook sets identity_verified.
    if (!profile?.identity_verified) {
      setError(t('candidacy.idGate', locale));
      return;
    }
    // The stored video/poster back a fresh submit never (#221): they live under the prior
    // candidacy's storage key and the new row must own its own object.
    const videoPath = upload.videoPath ?? (mode === 'edit' ? (initial?.video_url ?? null) : null);
    if (!edition || !videoPath || budget === null) return;
    // A replaced video invalidates the stored poster; an untouched one keeps it.
    const thumbPath = upload.videoPath
      ? upload.thumbPath
      : mode === 'edit'
        ? (initial?.thumb_path ?? null)
        : null;
    // A prior-cycle dream_id may point at a retired dream — a fresh submit links only the
    // author's CURRENT active dream (D12); RLS re-checks ownership either way.
    const dreamId = values.linkDream
      ? mode === 'edit'
        ? (initial?.dream_id ?? activeDream?.id ?? null)
        : (activeDream?.id ?? null)
      : null;
    setSubmitting(true);
    try {
      if (mode === 'edit' && initial) {
        await updateCandidacy(supabase, initial.id, {
          story: values.story.trim(),
          goal: values.goal.trim(),
          impact: values.impact.trim(),
          video_url: videoPath,
          thumb_path: thumbPath,
          plan: values.plan.trim(),
          budget_cents: budget.budgetCents,
          min_viable_cents: budget.minViableCents,
          skills_needed: values.skills,
          category: values.category,
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
            story: values.story.trim(),
            goal: values.goal.trim(),
            impact: values.impact.trim(),
            video_url: videoPath,
            thumb_path: thumbPath,
            plan: values.plan.trim(),
            budget_cents: budget.budgetCents,
            min_viable_cents: budget.minViableCents,
            skills_needed: values.skills,
            category: values.category,
            dream_id: dreamId,
          },
        });
        void qc.invalidateQueries({ queryKey: candidacyKeys.all });
        router.replace('/(modal)/candidacy-success');
      }
    } catch {
      setError(t(mode === 'edit' ? 'candidacy.error.update' : 'candidacy.error.submit', locale));
      setSubmitting(false);
    }
  };

  const isLast = step === TOTAL_STEPS - 1;
  // The step being shown. Its copy keys travel with it, so the wizard no longer builds
  // `candidacy.step${n}.…` out of an index it has to keep in range by hand.
  const active = stepAt(step);
  const input = active.input;

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
          <SectionLabel>{t(active.label, locale)}</SectionLabel>
          <Text className="mt-3 text-[25px] font-bold tracking-[-0.02em] text-foreground">
            {t(active.question, locale)}
          </Text>
          <Text className="mt-2 text-muted-foreground">{t(active.sub, locale)}</Text>

          {/* One mounted step, driven by WIZARD_STEPS. The four long-form fields were the
              same control four times over, so they come from `active.input`; the bespoke
              bodies below switch on the step's KEY, never on its index. The plan step is
              the one that mixes both, and carries on its container the gap its parts used
              to get from a wrapper of their own. */}
          <View className={active.key === 'plan' ? 'mt-5 gap-4' : 'mt-5'}>
            {input ? (
              <TextInput
                className="min-h-32 rounded-hero border border-hair bg-raise px-5 py-4 font-dream text-lg text-foreground"
                multiline
                maxLength={input.maxLength}
                placeholder={t(input.placeholder, locale)}
                value={values[input.field]}
                onChangeText={(v) => setText(input.field, v)}
              />
            ) : null}
            {active.key === 'video' ? (
              <View className="gap-3">
                {/* id-gate, stated where it bites (#412). Storage refuses the video object
                    itself unless identity_verified — the candidacy-videos insert policy
                    (20260617234036) carries the same precondition as the row INSERT — so an
                    unverified member used to walk four steps, get a 403 that rendered as
                    nothing, and only meet this sentence on step 7. No glow: a gate is not a
                    moment (rule #4). */}
                {!profile?.identity_verified ? (
                  <View className="gap-2 rounded-card border border-hair bg-raise px-4 py-3">
                    <Text className="text-[13px] leading-[18px] text-muted-foreground">
                      {t('candidacy.idGate', locale)}
                    </Text>
                    <Pressable
                      onPress={() => router.push('/(modal)/verify')}
                      accessibilityRole="button"
                    >
                      <Text className="text-[13px] font-semibold text-aura">
                        {t('candidacy.idGate.cta', locale)}
                      </Text>
                    </Pressable>
                  </View>
                ) : null}
                <VideoUploadTile
                  locale={locale}
                  status={upload.status}
                  failure={upload.failure}
                  progress={upload.progress}
                  posterUri={upload.posterUri}
                  standing={standing}
                  standingPosterUrl={
                    standing?.thumbPath ? standingUrls[standing.thumbPath] : undefined
                  }
                  isLoadingStandingPoster={isLoadingStandingPoster}
                  onPick={upload.pick}
                  onRecord={upload.record}
                  onCancel={upload.cancel}
                />
                {/* Edit mode: the stored video stands unless a replacement lands. */}
                {mode === 'edit' && initial && upload.status !== 'done' ? (
                  <Text className="text-[12px] leading-[18px] text-faint">
                    {t('candidacy.step4.keepHint', locale)}
                  </Text>
                ) : null}
              </View>
            ) : null}
            {active.key === 'plan' ? (
              <>
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
                      value={values.budgetEuro}
                      onChangeText={(v) => setText('budgetEuro', v)}
                    />
                  </View>
                  <View className="flex-1 gap-1.5">
                    <SectionLabel>{t('candidacy.budget.min.label', locale)}</SectionLabel>
                    <TextInput
                      className="rounded-hero border border-hair bg-raise px-5 py-4 text-lg text-foreground"
                      keyboardType="number-pad"
                      maxLength={9}
                      placeholder="5000"
                      value={values.minViableEuro}
                      onChangeText={(v) => setText('minViableEuro', v)}
                    />
                  </View>
                </View>
                <Text className="text-[12px] leading-[18px] text-faint">
                  {t('candidacy.budget.hint', locale)}
                </Text>
              </>
            ) : null}
            {active.key === 'skills' ? (
              // Skills the dream needs (#226, FUND-10) — curated keys, ≤ MAX_SKILLS, optional.
              <View className="flex-row flex-wrap gap-3">
                {SKILLS.map((key) => (
                  <Chip
                    key={key}
                    label={t(`tag.skill.${key}` as MessageKey, locale)}
                    selected={values.skills.includes(key)}
                    onPress={() => toggleSkill(key)}
                  />
                ))}
              </View>
            ) : null}
            {active.key === 'category' ? (
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
                        selected={values.category === key}
                        onPress={() =>
                          setValues((prev) => ({
                            ...prev,
                            category: prev.category === key ? null : key,
                          }))
                        }
                      />
                    ))}
                  </View>
                </View>
                {/* Optional link to the author's own personal dream (#226, D12/FUND-50). */}
                <View className="gap-3">
                  <SectionLabel>{t('candidacy.dream.label', locale)}</SectionLabel>
                  {activeDream || (mode === 'edit' && initial?.dream_id) ? (
                    <View className="gap-3">
                      <View className="flex-row flex-wrap gap-3">
                        <Chip
                          label={t('candidacy.dream.link', locale)}
                          selected={values.linkDream}
                          onPress={() =>
                            setValues((prev) => ({ ...prev, linkDream: !prev.linkDream }))
                          }
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

          {/* id-gate CTA (last step, unverified identity). Step 4 carries its own copy of this
              beside the upload tile (#412) — the same gate, said at both places it decides
              something: the video write and the row write. */}
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
                ? t(mode === 'edit' ? 'candidacy.edit.submit' : 'candidacy.submit', locale)
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
