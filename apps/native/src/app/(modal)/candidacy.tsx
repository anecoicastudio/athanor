import { useMemo, useState } from 'react';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { fundKeys, getActiveEdition, submitCandidacy } from '@athanor/api';
import { t, type MessageKey } from '@athanor/i18n';
import { Pressable, ScrollView, Text, TextInput, View } from '@/tw';
import { Button } from '@/components/Button';
import { SectionLabel } from '@/components/SectionLabel';
import { StepDots } from '@/components/StepDots';
import { VideoUploadTile } from '@/components/candidacy/VideoUploadTile';
import { useCandidacyUpload } from '@/lib/media/use-candidacy-upload';
import { useAuth } from '@/lib/auth-context';
import { supabase } from '@/lib/supabase';

/**
 * 5-step candidacy wizard (07 §3.4).
 * Steps: 1 story / 2 goal / 3 impact / 4 video / 5 plan.
 * Gated by identity_verified (real gate — M9 wires the Stripe Identity webhook).
 * Window-closed guard: if no open edition or candidacy_window_open=false → empty-state.
 * No Aura is awarded for candidacy (rule #1, asserted in pgTAP).
 */
export default function CandidacyWizard() {
  const router = useRouter();
  const { profile } = useAuth();
  const locale = profile?.locale ?? 'it';
  const uid = profile?.id ?? '';

  const editionQuery = useQuery({
    queryKey: fundKeys.activeEdition(),
    queryFn: () => getActiveEdition(supabase),
  });
  const edition = editionQuery.data ?? null;

  const [step, setStep] = useState(0); // 0–4 (displayed as steps 1–5)
  const [story, setStory] = useState('');
  const [goal, setGoal] = useState('');
  const [impact, setImpact] = useState('');
  const [planText, setPlanText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const upload = useCandidacyUpload(uid);

  // Whether the user can advance from the current step.
  const canAdvance = useMemo(() => {
    if (step === 3) return upload.status === 'done'; // video required to leave step 4
    const fieldForStep = [story, goal, impact, '', planText];
    const val = fieldForStep[step];
    return val !== undefined && val.trim().length > 0;
  }, [step, story, goal, impact, planText, upload.status]);

  const windowClosed = editionQuery.isSuccess && (!edition || !edition.candidacy_window_open);

  // window-closed: no open edition or window shut → empty-state instead of the wizard.
  if (windowClosed) {
    return (
      <View className="flex-1 items-center justify-center bg-background px-8">
        <Text className="text-center text-[15px] text-muted-foreground">
          {t('candidacy.windowClosed', locale)}
        </Text>
        <View className="mt-6 w-full">
          <Button variant="ghost" label={t('common.back', locale)} onPress={() => router.back()} />
        </View>
      </View>
    );
  }

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
    if (!canAdvance) {
      setError(t('candidacy.error.empty', locale));
      return;
    }
    // id-gate: real precondition — M9 Stripe Identity webhook sets identity_verified.
    if (!profile?.identity_verified) {
      setError(t('candidacy.idGate', locale));
      return;
    }
    if (!edition || !upload.videoPath) return;
    setSubmitting(true);
    try {
      await submitCandidacy(supabase, {
        id: upload.candidacyId,
        profileId: uid,
        input: {
          edition_id: edition.id,
          story: story.trim(),
          goal: goal.trim(),
          impact: impact.trim(),
          video_url: upload.videoPath,
          plan: planText.trim(),
        },
      });
      router.replace('/(modal)/candidacy-success');
    } catch {
      setError(t('candidacy.error.submit', locale));
      setSubmitting(false);
    }
  };

  const isLast = step === 4;
  // Build the step-scoped i18n key (e.g. 'candidacy.step1.q').
  const stepNum = (step + 1) as 1 | 2 | 3 | 4 | 5;
  const stepKey = (part: string) => `candidacy.step${stepNum}.${part}` as MessageKey;

  return (
    <ScrollView
      className="flex-1 bg-background"
      contentContainerClassName="grow px-7 pb-9 pt-16"
      keyboardShouldPersistTaps="handled"
    >
      {/* Header: back chevron + eyebrow */}
      <View className="flex-row items-center gap-3">
        <Pressable
          onPress={() => (step > 0 ? setStep((s) => s - 1) : router.back())}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel={t('common.back', locale)}
        >
          <Text className="text-muted-foreground">←</Text>
        </Pressable>
        <SectionLabel tone="aura">{t('candidacy.eyebrow', locale)}</SectionLabel>
      </View>

      {/* Step dots (5 dots, current and past filled cyan) */}
      <View className="mt-3">
        <StepDots count={5} current={step} />
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
            <VideoUploadTile
              locale={locale}
              status={upload.status}
              onPick={upload.pick}
              onRecord={upload.record}
            />
          ) : null}
          {step === 4 ? (
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
          ) : null}
        </View>

        {/* Error caption */}
        {error ? <Text className="mt-3 text-[13px] text-error">{error}</Text> : null}

        {/* id-gate CTA stub (step 5 only, unverified identity) */}
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
          label={isLast ? t('candidacy.submit', locale) : t('candidacy.continue', locale)}
          disabled={submitting || upload.status === 'uploading'}
          onPress={isLast ? () => void onSubmit() : advance}
        />
        <Text className="text-center text-[12px] leading-[18px] text-faint">
          {t('candidacy.legal', locale)}
        </Text>
      </View>
    </ScrollView>
  );
}
