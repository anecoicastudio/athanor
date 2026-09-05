import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { t } from '@athanor/i18n';
import { Pressable, ScrollView, Text, View } from '@/tw';
import { Button } from '@/components/Button';
import { Input } from '@/components/Input';
import { KeyboardAvoiding } from '@/components/KeyboardAvoiding';
import { Screen } from '@/components/Screen';
import { SectionLabel } from '@/components/SectionLabel';
import { authErrorKey } from '@/lib/auth-errors';
import { useAnnounceOnMount } from '@/lib/a11y';
import { useDraftLocale } from '@/hooks/use-draft-locale';
import { AUTH_REDIRECT_URL } from '@/lib/oauth';
import { supabase } from '@/lib/supabase';

// Same UX-only gate as (auth)/welcome — the real verdict is Supabase's.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Password recovery, request half (#631). resetPasswordForEmail sends the mail;
 * GoTrue answers 200 whether or not the address exists (enumeration protection),
 * so the sent state is unconditional on success and its copy says "se l'indirizzo
 * esiste" rather than promising a mail that may not come.
 *
 * The link must be opened ON THIS DEVICE: with flowType 'pkce' (lib/supabase.ts)
 * the code-verifier for the exchange lives in this install's AsyncStorage, and a
 * link opened elsewhere lands on auth-callback with a code nothing can redeem.
 * The sent card says so — it is the one failure copy can prevent.
 *
 * The exchange itself is auth-callback.tsx (shared with signup confirmation);
 * the PASSWORD_RECOVERY event latches auth-context.recoveryPending and AuthGuard
 * parks the session on (modal)/new-password — see those files for the race this
 * indirection exists to survive.
 */
export default function ForgotPasswordScreen() {
  const params = useLocalSearchParams<{ email?: string }>();
  const [email, setEmail] = useState(typeof params.email === 'string' ? params.email : '');
  const [phase, setPhase] = useState<'idle' | 'submitting' | 'sent'>('idle');
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const locale = useDraftLocale();
  const submitting = phase === 'submitting';
  const disabled = submitting || !EMAIL_RE.test(email.trim());

  // G2: state carried by text and announced explicitly (Android-only live regions
  // would leave iOS silent) — the same two transitions welcome.tsx announces.
  useAnnounceOnMount(
    submitting
      ? t('auth.forgot.sending', locale)
      : phase === 'sent'
        ? t('auth.forgot.sent.title', locale)
        : undefined,
  );

  const submit = async () => {
    setPhase('submitting');
    setError(null);
    const { error: err } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      // Shares the OAuth/signup allow-list entry (see welcome.tsx's emailRedirectTo
      // note): the link lands on auth-callback.tsx, which exchanges the PKCE code.
      redirectTo: AUTH_REDIRECT_URL,
    });
    if (err) {
      if (__DEV__) console.warn('[auth] resetPassword', err.status, err.code, err.message);
      setPhase('idle');
      setError(t(authErrorKey(err), locale));
      return;
    }
    setPhase('sent');
  };

  return (
    <KeyboardAvoiding>
      <Screen>
        <ScrollView
          className="flex-1"
          contentContainerClassName="grow px-5 pb-9 pt-4"
          keyboardShouldPersistTaps="handled"
        >
          {/* Reserved back slot, same recipe and same reason as welcome.tsx (#164). */}
          {/* `min-h` but a pinned `w` (#639): this slot is a COLUMN child of the ScrollView
            content container, where `align-items: stretch` would take a `min-w` box to the
            full width and centre the chevron mid-screen. The glyph never needed to grow
            sideways — only down. The `flex-row` slots elsewhere can use both. */}
          <View className="-ml-3 min-h-[44px] w-[44px]">
            {router.canGoBack() ? (
              <Pressable
                onPress={() => router.back()}
                accessibilityRole="button"
                accessibilityLabel={t('common.back', locale)}
                className="min-h-[44px] w-[44px] items-center justify-center"
              >
                <Text className="text-2xl text-foreground">‹</Text>
              </Pressable>
            ) : null}
          </View>

          {phase === 'sent' ? (
            /* Confirmation register, not moment register — the same rule-4 call the
              signup confirmation makes: nothing has happened yet, a mail is in
              flight. `success` mark, no ✦, no glow. */
            <View className="mt-6 gap-4">
              <SectionLabel tone="aura">{t('auth.forgot.sent.eyebrow', locale)}</SectionLabel>
              <Text className="text-[28px] font-bold tracking-[-0.02em] text-foreground">
                {t('auth.forgot.sent.title', locale)}
              </Text>

              <View className="mt-2 gap-3 rounded-hero border border-hair bg-raise p-5">
                <Text
                  className="text-2xl text-success"
                  accessibilityElementsHidden
                  importantForAccessibility="no-hide-descendants"
                >
                  ✓
                </Text>
                <Text className="text-[15px] leading-[22px] text-foreground">
                  {t('auth.forgot.sent.body', locale, { email: email.trim() })}
                </Text>
                {/* The one failure copy can prevent: a link opened on another device
                  has no code-verifier to meet it (PKCE) and dies as «varco scaduto». */}
                <Text className="text-[13px] text-muted-foreground">
                  {t('auth.forgot.sent.hint', locale)}
                </Text>
              </View>

              <Button
                variant="ghost"
                label={t('auth.forgot.sent.changeEmail', locale)}
                onPress={() => setPhase('idle')}
              />
            </View>
          ) : (
            <>
              <View className="mt-6 gap-3">
                <SectionLabel tone="aura">{t('auth.forgot.eyebrow', locale)}</SectionLabel>
                <Text className="text-[28px] font-bold tracking-[-0.02em] text-foreground">
                  {t('auth.forgot.display', locale)}
                </Text>
                <Text className="text-[15px] leading-[22px] text-muted-foreground">
                  {t('auth.forgot.sub', locale)}
                </Text>
              </View>

              <View className="mt-8 gap-2">
                <Text className="text-xs font-medium text-muted-foreground">
                  {t('auth.email.label', locale)}
                </Text>
                <Input
                  autoCapitalize="none"
                  autoComplete="email"
                  // #662: `emailAddress`, spelled out rather than left to RN's `autoComplete`
                  // mapping. Recovering an account, the address already exists and a full-field
                  // fill is the point — the opposite of the signup branch, which takes `none`
                  // (see the note in `(auth)/welcome.tsx`). Explicit because a DERIVED posture
                  // is one nothing can read: this field carried the same iOS AutoFill as
                  // signup's without ever naming it, which is how #615's residual stayed
                  // invisible here. §35 of `source-audit.test.ts` pins it.
                  textContentType="emailAddress"
                  keyboardType="email-address"
                  placeholder={t('auth.email.placeholder', locale)}
                  value={email}
                  onChangeText={setEmail}
                />
              </View>

              {error ? <Text className="mt-3 text-sm text-error">{error}</Text> : null}

              <View className="mt-7 gap-3">
                <Button
                  variant="light"
                  label={t('auth.forgot.cta', locale)}
                  disabled={disabled}
                  loading={submitting}
                  onPress={submit}
                />
                {submitting ? (
                  <Text className="text-center text-[13px] text-muted-foreground">
                    {t('auth.forgot.sending', locale)}
                  </Text>
                ) : null}
              </View>
            </>
          )}
        </ScrollView>
      </Screen>
    </KeyboardAvoiding>
  );
}
