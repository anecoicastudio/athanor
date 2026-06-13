import { useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { createDream, isHandleAvailable, updateOnboardingProfile } from '@auria/api';
import { IDENTITY_TAGS, SEEKING_TAGS, suggestHandle, validateOnboardingAnswers } from '@auria/core';
import { t, type MessageKey } from '@auria/i18n';
import { onboardingAnswersSchema, type Locale } from '@auria/schemas';
import { Pressable, ScrollView, Text, TextInput, View } from '@/tw';
import { useAuth } from '@/lib/auth-context';
import { supabase } from '@/lib/supabase';

const deviceLocale: Locale = (Intl.DateTimeFormat().resolvedOptions().locale ?? 'it').startsWith(
  'en',
)
  ? 'en'
  : 'it';

function Chip({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      className={
        selected
          ? 'rounded-full bg-foreground px-5 py-3'
          : 'rounded-full border border-line bg-surface px-5 py-3'
      }
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
    >
      <Text className={selected ? 'font-semibold text-background' : 'text-foreground'}>{label}</Text>
    </Pressable>
  );
}

function Dots({ step }: { step: number }) {
  return (
    <View className="flex-row gap-2">
      {[0, 1, 2, 3].map((i) => (
        <View
          key={i}
          className={i <= step ? 'h-2 w-2 rounded-full bg-foreground' : 'h-2 w-2 rounded-full bg-line'}
        />
      ))}
    </View>
  );
}

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
        <Dots step={step} />
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
          <Text className="text-3xl text-foreground">{t('onboarding.handle.title', locale)}</Text>
          <TextInput
            className="rounded-full border border-line bg-surface px-5 py-4 text-foreground"
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
          <Text className="text-3xl text-foreground">{t('onboarding.identity.title', locale)}</Text>
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
          <Text className="text-3xl text-foreground">{t('onboarding.seeking.title', locale)}</Text>
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
          <Text className="text-3xl text-foreground">{t('onboarding.dream.title', locale)}</Text>
          <TextInput
            className="min-h-32 rounded-3xl border border-line bg-surface px-5 py-4 text-foreground"
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
        <Pressable
          className={
            canNext
              ? 'h-[52px] items-center justify-center rounded-full bg-foreground'
              : 'h-[52px] items-center justify-center rounded-full bg-foreground opacity-40'
          }
          disabled={!canNext}
          onPress={() => setStep((s) => s + 1)}
          accessibilityRole="button"
        >
          <Text className="font-semibold tracking-widest text-background">
            {t('onboarding.next', locale)}
          </Text>
        </Pressable>
      ) : (
        <View className="items-center gap-4">
          <Pressable
            className={
              submitting || !dream.trim()
                ? 'h-[52px] w-full items-center justify-center rounded-full bg-aura opacity-40'
                : 'h-[52px] w-full items-center justify-center rounded-full bg-aura'
            }
            disabled={submitting || !dream.trim()}
            onPress={() => finish(true)}
            accessibilityRole="button"
          >
            <Text className="font-semibold tracking-widest text-background">
              ✦ {t('onboarding.dream.submit', locale)}
            </Text>
          </Pressable>
          <Pressable disabled={submitting} onPress={() => finish(false)} accessibilityRole="button">
            <Text className="tracking-widest text-muted-foreground">
              {t('onboarding.dream.later', locale)}
            </Text>
          </Pressable>
        </View>
      )}
    </ScrollView>
  );
}
