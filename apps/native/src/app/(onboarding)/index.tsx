import { useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, Platform, StyleSheet } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { semantic } from '@athanor/config';
import {
  IDENTITY_TAGS,
  MIN_MEMBER_AGE,
  SEEKING_TAGS,
  isAtLeastAge,
  zodiacSignFromBirthDate,
} from '@athanor/core';
import { localeTag, t, type MessageKey } from '@athanor/i18n';
import type { Locale } from '@athanor/schemas';
import { Image } from 'expo-image';
import { Pressable, ScrollView, Text, View } from '@/tw';
import { Button } from '@/components/Button';
import { Field } from '@/components/Field';
import { Chip } from '@/components/Chip';
import { ZodiacGlyph } from '@/components/glyphs';
import { Input } from '@/components/Input';
import { LocaleChips } from '@/components/LocaleChips';
import { MediaSheet } from '@/components/media/MediaSheet';
import { useReducedMotion } from '@/hooks/use-reduced-motion';
import { SectionLabel } from '@/components/SectionLabel';
import { StepBars } from '@/components/StepBars';
import { deviceLocale } from '@/lib/locale';
import { spoken } from '@/lib/star';
import { calendarDay, dayKey, parseCalendarDay } from '@/lib/time';
import { toggleTag } from '@/lib/tags';
import { FONT_SCALE_CAP } from '@/lib/type-scale';
import { loadDraft, saveDraft } from '@/lib/onboarding-draft';
import { KeyboardAvoiding } from '@/components/KeyboardAvoiding';
import { Screen } from '@/components/Screen';

/** identity → birth → seeking → dream → face. The last one is skippable and writes nothing required. */
const STEPS = 5;

/** The picker's opening year when no date is set yet: an adult, not today (#694). */
const DEFAULT_BIRTH_YEARS_BACK = 30;
/** How far back the picker scrolls. Beyond this the column's 1900 floor refuses anyway. */
const MAX_BIRTH_YEARS_BACK = 120;

/**
 * Onboarding funnel (prototype order: questions FIRST, account last). Runs with
 * NO session — anon has no `profiles` access — so the answers (identity, the birth date
 * (#694), seeking, dream, the locale picked on step 0 (#158), and since #76 an optional photo)
 * are kept in a local AsyncStorage draft
 * and flushed to the profile after OTP (see `lib/flush-onboarding.ts`). The photo
 * is stashed as a LOCAL uri for the same reason: every `avatars` storage policy
 * keys on auth.uid(), and there is no uid here yet. The NAME is not asked here —
 * (auth)/welcome collects it a screen later and handle_new_user writes it. The @handle is no longer
 * asked here; it's auto-derived from the email post-auth. Final step routes to
 * `(auth)/welcome` to create the account; «Accedi» jumps existing users to login.
 */
export default function OnboardingScreen() {
  const router = useRouter();

  // Defaults from the device (PRD §4.1), switchable on step 0 (#158) — the
  // earliest point, so a wrong default taints none of the funnel's copy and the
  // dream (step 2) gets written in the right language. The choice rides the
  // draft and lands on profiles.locale in the post-OTP flush, the same column
  // the settings picker writes.
  const [locale, setLocale] = useState<Locale>(deviceLocale);
  const [step, setStep] = useState(0);
  const [identity, setIdentity] = useState<string[]>([]);
  const [seeking, setSeeking] = useState<string[]>([]);
  const [dream, setDream] = useState('');
  const [avatarUri, setAvatarUri] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  // `YYYY-MM-DD`, local parts (#694). The screen owns the clock (`new Date()` below) so
  // @athanor/core stays pure; the sign is derived, never stored in state.
  const [birthDate, setBirthDate] = useState<string | null>(null);
  const [showPicker, setShowPicker] = useState(false);
  const reduceMotion = useReducedMotion();
  const revealOpacity = useRef(new Animated.Value(0)).current;

  // Resume an abandoned funnel: rehydrate the local draft on mount.
  useEffect(() => {
    let cancelled = false;
    loadDraft().then((d) => {
      if (cancelled || !d) return;
      setLocale(d.locale);
      setIdentity(d.identity_tags);
      setSeeking(d.seeking);
      setDream(d.dream);
      setAvatarUri(d.avatar_uri);
      setBirthDate(d.birth_date);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Announce the current step to screen readers whenever it changes (A-5).
  useEffect(() => {
    AccessibilityInfo.announceForAccessibility(
      spoken(t('onboarding.a11y.step', locale, { n: String(step + 1), total: String(STEPS) })),
    );
  }, [step, locale]);

  // Persist the latest answers on every transition so a relaunch resumes here.
  const persist = (next: {
    locale: Locale;
    identity: string[];
    seeking: string[];
    dream: string;
    avatarUri: string | null;
    birthDate: string | null;
  }) =>
    saveDraft({
      locale: next.locale,
      identity_tags: next.identity,
      seeking: next.seeking,
      dream: next.dream,
      avatar_uri: next.avatarUri,
      birth_date: next.birthDate,
    });

  // Persist immediately (not just on step transitions): switching language is the
  // kind of choice that must survive an abandoned funnel.
  const switchLocale = (next: Locale) => {
    if (next === locale) return;
    setLocale(next);
    void persist({ locale: next, identity, seeking, dream, avatarUri, birthDate });
  };

  // Step 1 (#694): the sign for the live reveal, and the 14+ floor (GDPR Art. 8, the Italian
  // floor). `new Date()` here, not in core — a boundary the screen owns.
  const sign = birthDate ? zodiacSignFromBirthDate(birthDate) : null;
  const tooYoung = birthDate !== null && !isAtLeastAge(birthDate, MIN_MEMBER_AGE, new Date());

  // The reveal fades in (rule #4: a flat line, no glow — a sign is granted, not earned).
  // Under Reduce Motion it appears; MomentFlash is the precedent.
  useEffect(() => {
    if (!sign || tooYoung) {
      revealOpacity.setValue(0);
      return;
    }
    revealOpacity.setValue(reduceMotion ? 1 : 0);
    if (reduceMotion) return;
    Animated.timing(revealOpacity, {
      toValue: 1,
      duration: 200,
      easing: Easing.ease,
      useNativeDriver: true,
    }).start();
  }, [sign, tooYoung, reduceMotion, revealOpacity]);

  const canNext = useMemo(() => {
    if (step === 0) return identity.length > 0;
    if (step === 1) return birthDate !== null && !tooYoung;
    if (step === 2) return seeking.length > 0;
    return true;
  }, [step, identity, seeking, birthDate, tooYoung]);

  const next = () => {
    persist({ locale, identity, seeking, dream, avatarUri, birthDate });
    setStep((s) => s + 1);
  };

  // Persist the draft to disk BEFORE navigating, so the post-auth flush can always
  // read it (a lost draft → incomplete profile → AuthGuard loops back here).
  const createAccount = async () => {
    await persist({ locale, identity, seeking, dream, avatarUri, birthDate });
    router.push('/(auth)/welcome');
  };

  const goLogin = () => router.push({ pathname: '/(auth)/welcome', params: { mode: 'login' } });

  const tagLabel = (prefix: 'tag.identity' | 'tag.seeking', key: string) =>
    t(`${prefix}.${key}` as MessageKey, locale);

  return (
    // #614 beyond-the-issue: that issue's out-of-scope note read this screen as a
    // top-anchored search field, which it is not. The dream field is centred, so the keyboard lands squarely on it,
    // so it had the same defect and takes the same primitive, outside `Screen`.
    <KeyboardAvoiding>
      <Screen>
        <ScrollView
          className="flex-1"
          contentContainerClassName="grow px-5 pb-9 pt-4"
          keyboardShouldPersistTaps="handled"
        >
          {/* Top bar: «Completa il profilo» (+ back) left, «Hai un account? Accedi» right. */}
          <View className="flex-row items-center justify-between gap-4">
            {/* Yoga's default flexShrink is 0, so without flex-1 here + shrink-0 on the login
            link the row overflows the gutter instead of compressing (EN strings are ~40pt
            wider than IT on a 390pt device). The eyebrow is the yielding side. */}
            <View className="flex-1 flex-row items-center gap-3">
              {/* The back slot is reserved unconditionally (#164): a conditionally rendered
              arrow moved the eyebrow's x-origin ~25pt between step 0 and 1. The slot is a
              real 44pt tap target (DESIGN §10 — the old bare glyph + hitSlop measured
              ~38pt wide). Literal `min-h-[44px] min-w-[44px]`, not `h-11`: a spacing step is 3.5px
              on device, so `h-11` is 38.5pt there while measuring a passing 44px on web —
              the same trap `Input.tsx` documents. -ml-3 keeps the glyph optically near the
              gutter. Step 0 renders
              the empty slot, not a disabled button, so screen readers gain no phantom
              control. */}
              <View className="-ml-3 min-h-[44px] min-w-[44px]">
                {step > 0 ? (
                  <Pressable
                    onPress={() => setStep((s) => s - 1)}
                    accessibilityRole="button"
                    accessibilityLabel={t('onboarding.back', locale)}
                    className="min-h-[44px] min-w-[44px] items-center justify-center"
                  >
                    <Text className="text-2xl text-foreground">‹</Text>
                  </Pressable>
                ) : null}
              </View>
              <SectionLabel numberOfLines={1} className="shrink">
                {t('onboarding.eyebrow', locale)}
              </SectionLabel>
            </View>
            <Pressable
              onPress={goLogin}
              accessibilityRole="button"
              // A 13px label + `hitSlop={8}` reached 33pt tall — under §10. The row is
              // already 44 tall (the reserved back slot), so a real box costs no layout.
              className="min-h-[44px] shrink-0 justify-center"
            >
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
                        onPress={() => setIdentity(toggleTag(identity, tag))}
                      />
                    ))}
                  </View>
                  {/* Locale picker (PRD §4.1, #158) — inline on the first step, no
                  step of its own. The small variant keeps it visually apart from
                  the identity tags above. */}
                  <View className="gap-3 pt-2">
                    <SectionLabel>{t('onboarding.locale.label', locale)}</SectionLabel>
                    <LocaleChips small value={locale} onChange={switchLocale} />
                  </View>
                </View>
              ) : null}

              {step === 1 ? (
                <View className="gap-4">
                  <SectionLabel>{t('onboarding.birth.eyebrow', locale)}</SectionLabel>
                  <Text className="text-[30px] font-bold tracking-[-0.02em] text-foreground">
                    {t('onboarding.birth.title', locale)}
                  </Text>
                  <Text className="text-muted-foreground">{t('onboarding.birth.sub', locale)}</Text>
                  {Platform.OS === 'web' ? (
                    // QA fallback only: @react-native-community/datetimepicker renders NOTHING
                    // on react-native-web (its src/datetimepicker.js warns «not supported on:
                    // web»), and Expo web is the only surface a walk can reach here.
                    <Input
                      placeholder={t('onboarding.birth.isoHint', locale)}
                      inputMode="numeric"
                      autoCapitalize="none"
                      autoCorrect={false}
                      defaultValue={birthDate ?? ''}
                      onChangeText={(v) => setBirthDate(/^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null)}
                    />
                  ) : (
                    <Pressable
                      onPress={() => setShowPicker(true)}
                      accessibilityRole="button"
                      className="rounded-card border border-hair bg-raise p-5"
                    >
                      <Text className="text-[15px] text-foreground">
                        {birthDate
                          ? calendarDay(birthDate, locale)
                          : t('onboarding.birth.pick', locale)}
                      </Text>
                    </Pressable>
                  )}
                  {showPicker ? (
                    <DateTimePicker
                      value={
                        birthDate
                          ? parseCalendarDay(birthDate)
                          : new Date(new Date().getFullYear() - DEFAULT_BIRTH_YEARS_BACK, 0, 1, 12)
                      }
                      mode="date"
                      // A year wheel, not a compact popover: a birthday is decades back.
                      display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                      themeVariant="dark"
                      locale={localeTag(locale)}
                      maximumDate={new Date()}
                      minimumDate={new Date(new Date().getFullYear() - MAX_BIRTH_YEARS_BACK, 0, 1)}
                      onChange={(_, picked) => {
                        setShowPicker(Platform.OS === 'ios');
                        // dayKey reads local parts — the same calendar day the wheel showed;
                        // a birthday is a day, never an instant (PlanPhaseCard precedent).
                        if (picked) setBirthDate(dayKey(picked.toISOString()));
                      }}
                    />
                  ) : null}
                  {tooYoung ? (
                    <Text className="text-sm text-error" accessibilityLiveRegion="polite">
                      {t('onboarding.birth.tooYoung', locale)}
                    </Text>
                  ) : null}
                  {sign && !tooYoung ? (
                    <Animated.View style={{ opacity: revealOpacity }}>
                      <View className="flex-row items-center gap-3 pt-2">
                        {/* The drawing is decorative; the line beside it is the announcement. */}
                        <View
                          accessibilityElementsHidden
                          importantForAccessibility="no-hide-descendants"
                        >
                          <ZodiacGlyph sign={sign} size={32} color={semantic.ink2} />
                        </View>
                        <Text
                          className="text-lg font-semibold text-foreground"
                          accessibilityLiveRegion="polite"
                        >
                          {t('onboarding.birth.reveal', locale, {
                            sign: t(`zodiac.${sign}` as MessageKey, locale),
                          })}
                        </Text>
                      </View>
                    </Animated.View>
                  ) : null}
                </View>
              ) : null}

              {step === 2 ? (
                <View className="gap-4">
                  <SectionLabel>{t('onboarding.seeking.eyebrow', locale)}</SectionLabel>
                  <Text className="text-[30px] font-bold tracking-[-0.02em] text-foreground">
                    {t('onboarding.seeking.title', locale)}
                  </Text>
                  <Text className="text-muted-foreground">
                    {t('onboarding.seeking.sub', locale)}
                  </Text>
                  <View className="flex-row flex-wrap gap-3">
                    {SEEKING_TAGS.map((tag) => (
                      <Chip
                        key={tag}
                        label={tagLabel('tag.seeking', tag)}
                        selected={seeking.includes(tag)}
                        onPress={() => setSeeking(toggleTag(seeking, tag))}
                      />
                    ))}
                  </View>
                </View>
              ) : null}

              {step === 3 ? (
                <View className="gap-4">
                  <SectionLabel tone="aura">{t('onboarding.dream.eyebrow', locale)}</SectionLabel>
                  <Text className="text-[30px] font-bold tracking-[-0.02em] text-foreground">
                    {t('onboarding.dream.title', locale)}
                  </Text>
                  <Text className="text-muted-foreground">{t('onboarding.dream.sub', locale)}</Text>
                  <Field
                    size="lg"
                    register="dream"
                    multiline
                    maxLength={500}
                    placeholder={t('onboarding.dream.placeholder', locale)}
                    value={dream}
                    onChangeText={setDream}
                  />
                </View>
              ) : null}

              {step === 4 ? (
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
                        // The empty avatar slot's placeholder. Decorative: the «Aggiungi una
                        // foto» control below is what names this (#635).
                        <Text
                          className="text-[40px] text-faint"
                          // `ornament` (#639): a 40px mark inside a hard 116pt disc, already
                          // hidden from assistive tech — scaling it only pushes it out.
                          maxFontSizeMultiplier={FONT_SCALE_CAP.ornament}
                          accessibilityElementsHidden
                          importantForAccessibility="no-hide-descendants"
                        >
                          ✦
                        </Text>
                      )}
                    </View>
                    {/* The only control that performs step 5 — the 116pt avatar above is a
                    View, not a target. Bare, it was a 15px line box ≈19.5pt tall (§10). */}
                    <Pressable
                      accessibilityRole="button"
                      onPress={() => setSheetOpen(true)}
                      className="min-h-[44px] justify-center px-4"
                    >
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
                          void persist({
                            locale,
                            identity,
                            seeking,
                            dream,
                            avatarUri: null,
                            birthDate,
                          });
                        }}
                        className="min-h-[44px] justify-center px-4"
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
              void persist({ locale, identity, seeking, dream, avatarUri: asset.uri, birthDate });
            }}
          />
        </ScrollView>
      </Screen>
    </KeyboardAvoiding>
  );
}
