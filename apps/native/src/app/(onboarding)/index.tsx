import { useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { AccessibilityInfo } from 'react-native';
import { IDENTITY_TAGS, SEEKING_TAGS } from '@athanor/core';
import { t, type MessageKey } from '@athanor/i18n';
import { Pressable, ScrollView, Text, TextInput, View } from '@/tw';
import { Button } from '@/components/Button';
import { Chip } from '@/components/Chip';
import { StepBars } from '@/components/StepBars';
import { deviceLocale } from '@/lib/locale';
import { loadDraft, saveDraft } from '@/lib/onboarding-draft';

/**
 * Onboarding funnel (prototype order: questions FIRST, account last). Runs with
 * NO session — anon has no `profiles` access — so the three answers (identity,
 * seeking, dream) are kept in a local AsyncStorage draft and flushed to the
 * profile after OTP (see `lib/flush-onboarding.ts`). The @handle is no longer
 * asked here; it's auto-derived from the email post-auth. Final step routes to
 * `(auth)/welcome` to create the account; «Accedi» jumps existing users to login.
 */
export default function OnboardingScreen() {
  const router = useRouter();
  const locale = deviceLocale;

  const [step, setStep] = useState(0);
  const [identity, setIdentity] = useState<string[]>([]);
  const [seeking, setSeeking] = useState<string[]>([]);
  const [dream, setDream] = useState('');

  // Resume an abandoned funnel: rehydrate the local draft on mount.
  useEffect(() => {
    let cancelled = false;
    loadDraft().then((d) => {
      if (cancelled || !d) return;
      setIdentity(d.identity_tags);
      setSeeking(d.seeking);
      setDream(d.dream);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Announce the current step to screen readers whenever it changes (A-5).
  useEffect(() => {
    AccessibilityInfo.announceForAccessibility(
      t('onboarding.a11y.step', locale, { n: String(step + 1), total: '3' }),
    );
  }, [step, locale]);

  const toggle = (list: string[], set: (v: string[]) => void, tag: string) =>
    set(list.includes(tag) ? list.filter((x) => x !== tag) : [...list, tag]);

  // Persist the latest answers on every transition so a relaunch resumes here.
  const persist = (next: { identity: string[]; seeking: string[]; dream: string }) =>
    saveDraft({
      locale,
      identity_tags: next.identity,
      seeking: next.seeking,
      dream: next.dream,
    });

  const canNext = useMemo(() => {
    if (step === 0) return identity.length > 0;
    if (step === 1) return seeking.length > 0;
    return true;
  }, [step, identity, seeking]);

  const next = () => {
    persist({ identity, seeking, dream });
    setStep((s) => s + 1);
  };

  // Persist the draft to disk BEFORE navigating, so the post-auth flush can always
  // read it (a lost draft → incomplete profile → AuthGuard loops back here).
  const createAccount = async () => {
    await persist({ identity, seeking, dream });
    router.push('/(auth)/welcome');
  };

  const goLogin = () => router.push({ pathname: '/(auth)/welcome', params: { mode: 'login' } });

  const tagLabel = (prefix: 'tag.identity' | 'tag.seeking', key: string) =>
    t(`${prefix}.${key}` as MessageKey, locale);

  return (
    <ScrollView
      className="flex-1 bg-background"
      contentContainerClassName="grow px-7 pb-9 pt-16"
      keyboardShouldPersistTaps="handled"
    >
      {/* Top bar: «Completa il profilo» (+ back) left, «Hai un account? Accedi» right. */}
      <View className="flex-row items-center justify-between gap-4">
        <View className="flex-row items-center gap-3">
          {step > 0 ? (
            <Pressable
              onPress={() => setStep((s) => s - 1)}
              accessibilityRole="button"
              accessibilityLabel={t('onboarding.back', locale)}
              hitSlop={12}
            >
              <Text className="text-muted-foreground">←</Text>
            </Pressable>
          ) : null}
          <Text className="text-[11px] font-semibold uppercase tracking-[0.16em] text-faint">
            {t('onboarding.eyebrow', locale)}
          </Text>
        </View>
        <Pressable onPress={goLogin} accessibilityRole="button" hitSlop={8}>
          <Text className="text-[13px] font-semibold text-aura">
            {t('auth.haveAccount', locale)}
          </Text>
        </Pressable>
      </View>
      <View className="mt-3">
        <StepBars count={3} current={step} />
      </View>

      {/* Centre: the active step's question, vertically centred. */}
      <View className="grow justify-center">
        <View>
          {step === 0 ? (
            <View className="gap-4">
              <Text className="text-[11px] font-semibold uppercase tracking-[0.16em] text-faint">
                {t('onboarding.identity.eyebrow', locale)}
              </Text>
              <Text className="text-[30px] font-bold tracking-[-0.025em] text-foreground">
                {t('onboarding.identity.title', locale)}
              </Text>
              <Text className="text-muted-foreground">{t('onboarding.identity.sub', locale)}</Text>
              <View className="flex-row flex-wrap gap-3">
                {IDENTITY_TAGS.map((tag) => (
                  <Chip
                    key={tag}
                    label={tagLabel('tag.identity', tag)}
                    selected={identity.includes(tag)}
                    onPress={() => toggle(identity, setIdentity, tag)}
                  />
                ))}
              </View>
            </View>
          ) : null}

          {step === 1 ? (
            <View className="gap-4">
              <Text className="text-[11px] font-semibold uppercase tracking-[0.16em] text-faint">
                {t('onboarding.seeking.eyebrow', locale)}
              </Text>
              <Text className="text-[30px] font-bold tracking-[-0.025em] text-foreground">
                {t('onboarding.seeking.title', locale)}
              </Text>
              <Text className="text-muted-foreground">{t('onboarding.seeking.sub', locale)}</Text>
              <View className="flex-row flex-wrap gap-3">
                {SEEKING_TAGS.map((tag) => (
                  <Chip
                    key={tag}
                    label={tagLabel('tag.seeking', tag)}
                    selected={seeking.includes(tag)}
                    onPress={() => toggle(seeking, setSeeking, tag)}
                  />
                ))}
              </View>
            </View>
          ) : null}

          {step === 2 ? (
            <View className="gap-4">
              <Text className="text-[11px] font-semibold uppercase tracking-[0.16em] text-aura">
                {t('onboarding.dream.eyebrow', locale)}
              </Text>
              <Text className="text-[30px] font-bold tracking-[-0.025em] text-foreground">
                {t('onboarding.dream.title', locale)}
              </Text>
              <Text className="text-muted-foreground">{t('onboarding.dream.sub', locale)}</Text>
              <TextInput
                className="min-h-32 rounded-hero border border-hair bg-raise px-5 py-4 font-dream text-lg text-foreground"
                multiline
                maxLength={500}
                placeholder={t('onboarding.dream.placeholder', locale)}
                value={dream}
                onChangeText={setDream}
              />
            </View>
          ) : null}
        </View>
      </View>

      {/* CTA pinned at the bottom — cyan «light» button per the prototype. */}
      <View className="mt-6">
        {step < 2 ? (
          <Button
            variant="light"
            label={t('onboarding.next', locale)}
            accessibilityLabel={t('onboarding.next', locale)}
            disabled={!canNext}
            onPress={next}
          />
        ) : (
          <Button
            variant="light"
            label={t('onboarding.createAccount', locale)}
            accessibilityLabel={t('onboarding.createAccount', locale)}
            onPress={createAccount}
          />
        )}
      </View>
    </ScrollView>
  );
}
