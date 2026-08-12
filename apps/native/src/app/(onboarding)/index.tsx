import { useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { AccessibilityInfo, StyleSheet } from 'react-native';
import { IDENTITY_TAGS, SEEKING_TAGS } from '@athanor/core';
import { t, type MessageKey } from '@athanor/i18n';
import { Image } from 'expo-image';
import { Pressable, ScrollView, Text, TextInput, View } from '@/tw';
import { Button } from '@/components/Button';
import { Chip } from '@/components/Chip';
import { MediaSheet } from '@/components/media/MediaSheet';
import { SectionLabel } from '@/components/SectionLabel';
import { StepBars } from '@/components/StepBars';
import { deviceLocale } from '@/lib/locale';
import { loadDraft, saveDraft } from '@/lib/onboarding-draft';
import { Screen } from '@/components/Screen';

/** identity → seeking → dream → face. The last one is skippable and writes nothing required. */
const STEPS = 4;

/**
 * Onboarding funnel (prototype order: questions FIRST, account last). Runs with
 * NO session — anon has no `profiles` access — so the answers (identity, seeking,
 * dream, and since #76 an optional photo) are kept in a local AsyncStorage draft
 * and flushed to the profile after OTP (see `lib/flush-onboarding.ts`). The photo
 * is stashed as a LOCAL uri for the same reason: every `avatars` storage policy
 * keys on auth.uid(), and there is no uid here yet. The NAME is not asked here —
 * (auth)/welcome collects it a screen later and handle_new_user writes it. The @handle is no longer
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
  const [avatarUri, setAvatarUri] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);

  // Resume an abandoned funnel: rehydrate the local draft on mount.
  useEffect(() => {
    let cancelled = false;
    loadDraft().then((d) => {
      if (cancelled || !d) return;
      setIdentity(d.identity_tags);
      setSeeking(d.seeking);
      setDream(d.dream);
      setAvatarUri(d.avatar_uri);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Announce the current step to screen readers whenever it changes (A-5).
  useEffect(() => {
    AccessibilityInfo.announceForAccessibility(
      t('onboarding.a11y.step', locale, { n: String(step + 1), total: String(STEPS) }),
    );
  }, [step, locale]);

  const toggle = (list: string[], set: (v: string[]) => void, tag: string) =>
    set(list.includes(tag) ? list.filter((x) => x !== tag) : [...list, tag]);

  // Persist the latest answers on every transition so a relaunch resumes here.
  const persist = (next: {
    identity: string[];
    seeking: string[];
    dream: string;
    avatarUri: string | null;
  }) =>
    saveDraft({
      locale,
      identity_tags: next.identity,
      seeking: next.seeking,
      dream: next.dream,
      avatar_uri: next.avatarUri,
    });

  const canNext = useMemo(() => {
    if (step === 0) return identity.length > 0;
    if (step === 1) return seeking.length > 0;
    return true;
  }, [step, identity, seeking]);

  const next = () => {
    persist({ identity, seeking, dream, avatarUri });
    setStep((s) => s + 1);
  };

  // Persist the draft to disk BEFORE navigating, so the post-auth flush can always
  // read it (a lost draft → incomplete profile → AuthGuard loops back here).
  const createAccount = async () => {
    await persist({ identity, seeking, dream, avatarUri });
    router.push('/(auth)/welcome');
  };

  const goLogin = () => router.push({ pathname: '/(auth)/welcome', params: { mode: 'login' } });

  const tagLabel = (prefix: 'tag.identity' | 'tag.seeking', key: string) =>
    t(`${prefix}.${key}` as MessageKey, locale);

  return (
    <Screen>
      <ScrollView
        className="flex-1"
        contentContainerClassName="grow px-7 pb-9 pt-4"
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
            <SectionLabel>{t('onboarding.eyebrow', locale)}</SectionLabel>
          </View>
          <Pressable onPress={goLogin} accessibilityRole="button" hitSlop={8}>
            <Text className="text-[13px] font-semibold text-aura">
              {t('auth.haveAccount', locale)}
            </Text>
          </Pressable>
        </View>
        <View className="mt-3">
          <StepBars count={STEPS} current={step} />
        </View>

        {/* Centre: the active step's question, vertically centred. */}
        <View className="grow justify-center">
          <View>
            {step === 0 ? (
              <View className="gap-4">
                <SectionLabel>{t('onboarding.identity.eyebrow', locale)}</SectionLabel>
                <Text className="text-[30px] font-bold tracking-[-0.02em] text-foreground">
                  {t('onboarding.identity.title', locale)}
                </Text>
                <Text className="text-muted-foreground">
                  {t('onboarding.identity.sub', locale)}
                </Text>
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
                <SectionLabel>{t('onboarding.seeking.eyebrow', locale)}</SectionLabel>
                <Text className="text-[30px] font-bold tracking-[-0.02em] text-foreground">
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
                <SectionLabel tone="aura">{t('onboarding.dream.eyebrow', locale)}</SectionLabel>
                <Text className="text-[30px] font-bold tracking-[-0.02em] text-foreground">
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

            {step === 3 ? (
              <View className="gap-4">
                <SectionLabel>{t('onboarding.face.eyebrow', locale)}</SectionLabel>
                <Text className="text-[30px] font-bold tracking-[-0.02em] text-foreground">
                  {t('onboarding.face.title', locale)}
                </Text>
                <Text className="text-muted-foreground">{t('onboarding.face.sub', locale)}</Text>
                <View className="items-center gap-4 pt-2">
                  {/* No Avatar here: it resolves a STORAGE key through a signed URL, and this
                    photo has no key yet — it is a local file that nobody has uploaded. */}
                  <View className="h-[116px] w-[116px] items-center justify-center overflow-hidden rounded-full border border-hair bg-surface-muted">
                    {avatarUri ? (
                      <Image
                        source={{ uri: avatarUri }}
                        style={StyleSheet.absoluteFill}
                        contentFit="cover"
                      />
                    ) : (
                      <Text className="text-[40px] text-faint">✦</Text>
                    )}
                  </View>
                  <Pressable accessibilityRole="button" onPress={() => setSheetOpen(true)}>
                    <Text className="text-[15px] font-semibold text-aura">
                      {avatarUri
                        ? t('onboarding.face.change', locale)
                        : t('onboarding.face.add', locale)}
                    </Text>
                  </Pressable>
                  {avatarUri ? (
                    <Pressable
                      accessibilityRole="button"
                      onPress={() => {
                        setAvatarUri(null);
                        void persist({ identity, seeking, dream, avatarUri: null });
                      }}
                    >
                      <Text className="text-[13px] text-muted-foreground">
                        {t('onboarding.face.remove', locale)}
                      </Text>
                    </Pressable>
                  ) : null}
                </View>
              </View>
            ) : null}
          </View>
        </View>

        {/* CTA pinned at the bottom — cyan «light» button per the prototype. */}
        <View className="mt-6">
          {step < STEPS - 1 ? (
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

        {/* Kept mounted (see MediaSheet's docblock — iOS launches from onDismiss). Nothing is
          uploaded here: with no session there is no uid, and every avatars policy keys on it.
          The local uri rides the draft and `flushOnboardingDraft` uploads it after the OTP. */}
        <MediaSheet
          visible={sheetOpen}
          locale={locale}
          onClose={() => setSheetOpen(false)}
          onPick={(asset) => {
            if (asset.kind !== 'image') return;
            setAvatarUri(asset.uri);
            void persist({ identity, seeking, dream, avatarUri: asset.uri });
          }}
        />
      </ScrollView>
    </Screen>
  );
}
