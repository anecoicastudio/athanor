import { useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { createDream, isHandleAvailable, updateOnboardingProfile } from '@auria/api';
import { IDENTITY_TAGS, SEEKING_TAGS, suggestHandle, validateOnboardingAnswers } from '@auria/core';
import { t, type MessageKey } from '@auria/i18n';
import { onboardingAnswersSchema, type Locale } from '@auria/schemas';
import { Pressable, ScrollView, Text, TextInput, View } from '@/tw';
import { useAuth } from '@/lib/auth-context';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/Button';
import { Chip } from '@/components/Chip';
import { StepDots } from '@/components/StepDots';

const deviceLocale: Locale = (Intl.DateTimeFormat().resolvedOptions().locale ?? 'it').startsWith(
  'en',
)
  ? 'en'
  : 'it';

export default function OnboardingScreen() {
  const { session, refreshProfile } = useAuth();
  const router = useRouter();

  const [step, setStep] = useState(0);
  const [handle, setHandle] = useState('');
  const [locale, setLocale] = useState<Locale>(deviceLocale);
  const [handleStatus, setHandleStatus] = useState<
    'idle' | 'checking' | 'free' | 'taken' | 'invalid'
  >('idle');
  const [identity, setIdentity] = useState<string[]>([]);
  const [seeking, setSeeking] = useState<string[]>([]);
  const [dream, setDream] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const email = session?.user.email ?? '';
  useEffect(() => {
    // queueMicrotask avoids synchronous setState-in-effect (react-hooks/set-state-in-effect)
    if (email) queueMicrotask(() => setHandle((h) => h || suggestHandle(email)));
  }, [email]);

  // debounced live availability check (UX pre-check; DB unique constraint is the real guard)
  useEffect(() => {
    const isValid = /^[a-z0-9_]{3,30}$/.test(handle);
    // queueMicrotask avoids synchronous setState-in-effect (react-hooks/set-state-in-effect)
    if (!isValid) {
      const next = handle ? ('invalid' as const) : ('idle' as const);
      queueMicrotask(() => setHandleStatus(next));
      return;
    }
    queueMicrotask(() => setHandleStatus('checking'));
    let cancelled = false;
    const id = setTimeout(() => {
      isHandleAvailable(supabase, handle)
        .then((free) => {
          if (!cancelled) setHandleStatus(free ? 'free' : 'taken');
        })
        .catch(() => {
          if (!cancelled) setHandleStatus('idle');
        });
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(id);
    };
  }, [handle]);

  const toggle = (list: string[], set: (v: string[]) => void, tag: string) =>
    set(list.includes(tag) ? list.filter((x) => x !== tag) : [...list, tag]);

  const canNext = useMemo(() => {
    if (step === 0) return handleStatus === 'free';
    if (step === 1) return identity.length > 0;
    if (step === 2) return seeking.length > 0;
    return true;
  }, [step, handleStatus, identity, seeking]);

  const finish = async (plantDream: boolean) => {
    if (!session) return;
    setSubmitting(true);
    setError(null);
    try {
      const answers = onboardingAnswersSchema.parse({
        handle,
        locale,
        identity_tags: identity,
        seeking,
      });
      const vocab = validateOnboardingAnswers(answers);
      if (!vocab.ok) throw new Error(vocab.field);
      await updateOnboardingProfile(supabase, session.user.id, answers);
      if (plantDream && dream.trim()) {
        await createDream(supabase, { profile_id: session.user.id, text: dream.trim() });
      }
      await refreshProfile();
      router.replace('/');
    } catch {
      setError(t('onboarding.error.submit', locale));
    } finally {
      setSubmitting(false);
    }
  };

  const tagLabel = (prefix: 'tag.identity' | 'tag.seeking', key: string) =>
    t(`${prefix}.${key}` as MessageKey, locale);

  return (
    <ScrollView
      className="flex-1 bg-background"
      contentContainerClassName="grow justify-center gap-8 px-5 py-16"
      keyboardShouldPersistTaps="handled"
    >
      <View className="flex-row items-center justify-between">
        <StepDots count={4} current={step} />
        {step > 0 ? (
          <Pressable
            onPress={() => setStep((s) => s - 1)}
            accessibilityRole="button"
            accessibilityLabel={t('onboarding.back', locale)}
            hitSlop={12}
            disabled={submitting}
          >
            <Text className="text-muted-foreground">←</Text>
          </Pressable>
        ) : null}
      </View>

      {step === 0 ? (
        <View className="gap-4">
          <Text className="text-[30px] font-bold tracking-[-0.025em] text-foreground">
            {t('onboarding.handle.title', locale)}
          </Text>
          <TextInput
            className="rounded-ctl border border-hair bg-raise px-5 py-4 text-foreground"
            autoCapitalize="none"
            autoCorrect={false}
            placeholder={t('onboarding.handle.placeholder', locale)}
            value={handle}
            onChangeText={(v) => setHandle(v.toLowerCase())}
          />
          {handleStatus === 'taken' ? (
            <Text className="text-sm text-error">{t('onboarding.handle.taken', locale)}</Text>
          ) : null}
          {handleStatus === 'invalid' ? (
            <Text className="text-sm text-error">{t('onboarding.handle.invalid', locale)}</Text>
          ) : null}
          <Text className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            {t('onboarding.locale.label', locale)}
          </Text>
          <View className="flex-row gap-3">
            <Chip label="Italiano" selected={locale === 'it'} onPress={() => setLocale('it')} />
            <Chip label="English" selected={locale === 'en'} onPress={() => setLocale('en')} />
          </View>
        </View>
      ) : null}

      {step === 1 ? (
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

      {step === 2 ? (
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

      {step === 3 ? (
        <View className="gap-4">
          <Text className="text-[11px] font-semibold uppercase tracking-[0.16em] text-aura">
            {t('onboarding.dream.eyebrow', locale)}
          </Text>
          <Text className="text-[30px] font-bold tracking-[-0.025em] text-foreground">
            {t('onboarding.dream.title', locale)}
          </Text>
          <Text className="text-muted-foreground">{t('onboarding.dream.sub', locale)}</Text>
          <TextInput
            className="min-h-32 rounded-hero border border-hair bg-raise px-5 py-4 text-foreground"
            multiline
            maxLength={500}
            placeholder={t('onboarding.dream.placeholder', locale)}
            value={dream}
            onChangeText={setDream}
          />
        </View>
      ) : null}

      {error ? <Text className="text-sm text-error">{error}</Text> : null}

      {step < 3 ? (
        <Button
          variant="primary"
          label={t('onboarding.next', locale)}
          disabled={!canNext}
          onPress={() => setStep((s) => s + 1)}
        />
      ) : (
        <View className="items-center gap-4">
          <Button
            variant="light"
            label={`✦ ${t('onboarding.dream.submit', locale)}`}
            disabled={submitting || !dream.trim()}
            onPress={() => finish(true)}
          />
          <Pressable disabled={submitting} onPress={() => finish(false)} accessibilityRole="button">
            <Text className="tracking-widest text-faint">
              {t('onboarding.dream.later', locale)}
            </Text>
          </Pressable>
        </View>
      )}
    </ScrollView>
  );
}
