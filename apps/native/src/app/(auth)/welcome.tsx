import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator } from 'react-native';
import { t, type MessageKey } from '@athanor/i18n';
import { semantic } from '@athanor/config';
import { PASSWORD_REQUIREMENTS, passwordSchema, unmetPasswordRequirements } from '@athanor/schemas';
import { Pressable, ScrollView, Text, TextInput, View } from '@/tw';
import { deviceLocale } from '@/lib/locale';
import { signInWithProvider } from '@/lib/oauth';
import { clearPendingReferral, getPendingReferral } from '@/lib/referral';
import { supabase } from '@/lib/supabase';
import { SectionLabel } from '@/components/SectionLabel';

// Well-formed check (UX gate only) — the real validity verdict is Supabase's.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Apple sign-in needs the Supabase Apple provider, which requires a paid Apple
// Developer account (Services ID + key) — not yet configured. Flip to true once it
// is; the code path is provider-agnostic and needs no other change.
const APPLE_ENABLED = false;

// Same story for Google: the hosted project has only the Email provider enabled, so this
// button could only ever reach «Quel modo di entrare non è ancora attivo». To flip it on,
// configure the Google provider in Supabase → Auth → Providers AND add the redirect that
// lib/oauth.ts builds — athanor://auth-callback, plus the exp://…/--/auth-callback form
// for Expo Go — to Auth → URL Configuration → Redirect URLs. Missing that second step is
// the classic "works in the browser, hangs on device".
const GOOGLE_ENABLED = false;

const ANY_OAUTH = APPLE_ENABLED || GOOGLE_ENABLED;

// Map a Supabase AuthError to a specific message so the cause is visible, instead
// of a blanket "Something didn't work." signInWithPassword returns invalid_credentials
// for both wrong password and unknown email (enumeration protection), so those collapse.
function authErrorKey(err: { code?: string; status?: number }): MessageKey {
  if (err.code === 'invalid_credentials') return 'auth.error.invalidCredentials';
  if (err.code === 'user_already_exists' || err.code === 'email_exists')
    return 'auth.error.emailTaken';
  if (err.code === 'weak_password') return 'auth.error.weakPassword';
  if (err.code === 'email_address_invalid') return 'auth.error.invalidEmail';
  if (err.code === 'over_request_rate_limit' || err.status === 429) return 'auth.error.rateLimit';
  return 'auth.error.generic';
}

// signInWithProvider already carries the real reason (provider error, exchange
// failure, missing code) — it used to be dropped into a dev warn, which is how
// "Unsupported provider: provider is not enabled" stayed invisible while the
// user read "Something didn't work."
function oauthErrorKey(message: string): MessageKey {
  if (/provider is not enabled|unsupported provider/i.test(message))
    return 'auth.error.providerDisabled';
  return 'auth.error.oauthFailed';
}

const PROVIDER_LABEL: Record<'apple' | 'google', string> = { apple: 'Apple', google: 'Google' };

export default function WelcomeScreen() {
  const { mode } = useLocalSearchParams<{ mode?: string }>();
  const login = mode === 'login'; // existing-user sign-in vs new-account creation
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [oauthBusy, setOauthBusy] = useState<null | 'apple' | 'google'>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const router = useRouter();
  const locale = deviceLocale;

  const copy = (suffix: 'eyebrow' | 'display' | 'sub') =>
    t(`${login ? 'auth.login' : 'auth.signup'}.${suffix}` as MessageKey, locale);

  // On success the session triggers onAuthStateChange → auth-context hydrates the
  // profile + flushes the onboarding draft → AuthGuard routes to Home. No nav here.
  const submit = async () => {
    setSubmitting(true);
    setError(null);
    setNotice(null);
    if (login) {
      const { error: err } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      setSubmitting(false);
      if (err) {
        if (__DEV__) console.warn('[auth] signIn', err.status, err.code, err.message);
        setError(t(authErrorKey(err), locale));
        return;
      }
      // A code stashed on this device (e.g. from a link opened before the user chose to
      // sign into an existing, unrelated account) must never attach to that account.
      void clearPendingReferral();
      return;
    }
    // `display_name` lives in auth.users.user_metadata for now — `profiles` has no
    // name column yet (deferred to M2's @handle page; add a column + flush then).
    // It's retrievable via session.user.user_metadata.display_name in the meantime.
    // Referral attribution is email-signup-only for now: OAuth signups don't carry
    // this metadata, so a code stashed ahead of a Google/Apple signup is silently lost.
    // The disabled button is a hint, not a guarantee: a password manager can fill
    // the field and fire submit in the same frame. Parse at the boundary too.
    if (!passwordSchema.safeParse(password).success) {
      setSubmitting(false);
      setError(t('auth.error.weakPassword', locale));
      return;
    }
    const referral = await getPendingReferral();
    const { data, error: err } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: {
        data: {
          display_name: name.trim(),
          ...(referral ? { referral_code: referral } : {}),
        },
      },
    });
    setSubmitting(false);
    if (err) {
      if (__DEV__) console.warn('[auth] signUp', err.status, err.code, err.message);
      setError(t(authErrorKey(err), locale));
      return;
    }
    void clearPendingReferral();
    // With confirmations ON, a signup for an address that already exists comes
    // back 200 with an obfuscated user rather than 422 — an empty `identities`
    // is the only tell. Without this the user is sent to wait for a mail that
    // is never sent.
    if (data.user && (data.user.identities?.length ?? 0) === 0) {
      setError(t('auth.error.emailTaken', locale));
      return;
    }
    // Confirmations OFF (dev) → session is set → AuthGuard routes. Confirmations ON →
    // no session yet, so prompt the user to confirm via email.
    if (!data.session) setNotice(t('auth.confirmEmail', locale));
  };

  // OAuth: success routes via onAuthStateChange; cancellation is silent.
  const handleOAuth = async (provider: 'apple' | 'google') => {
    setError(null);
    setNotice(null);
    setOauthBusy(provider);
    const outcome = await signInWithProvider(provider);
    setOauthBusy(null);
    if (outcome.status === 'error') {
      if (__DEV__) console.warn('[auth] oauth', provider, outcome.message);
      setError(t(oauthErrorKey(outcome.message), locale, { provider: PROVIDER_LABEL[provider] }));
    }
  };

  // Sign-UP enforces the full policy; sign-IN only needs a non-empty field.
  // Accounts made before the policy hold passwords that fail it, and refusing
  // to even attempt their login would lock them out.
  const unmet = unmetPasswordRequirements(password);
  const busy = submitting || oauthBusy !== null;
  const disabled =
    busy || !EMAIL_RE.test(email.trim()) || (login ? password.length === 0 : unmet.length > 0);

  const toggleMode = () =>
    router.replace(
      login ? '/(auth)/welcome' : { pathname: '/(auth)/welcome', params: { mode: 'login' } },
    );

  return (
    <ScrollView
      className="flex-1 bg-background"
      contentContainerClassName="grow px-7 pb-9 pt-16"
      keyboardShouldPersistTaps="handled"
    >
      {router.canGoBack() ? (
        <Pressable
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel={t('common.back', locale)}
          hitSlop={12}
        >
          <Text className="text-2xl text-foreground">‹</Text>
        </Pressable>
      ) : null}

      <View className="mt-6 gap-2">
        <SectionLabel tone="aura">{copy('eyebrow')}</SectionLabel>
        <Text className="text-[28px] font-bold tracking-[-0.02em] text-foreground">
          {copy('display')}
        </Text>
        <Text className="text-sm text-muted-foreground">{copy('sub')}</Text>
      </View>

      {/* OAuth on top, per the prototype. Each provider is hidden until it is configured
          in Supabase; with none of them on, the block AND the «oppure con email» divider
          go too — a divider separating email from nothing reads as a broken screen. */}
      {ANY_OAUTH ? (
        <>
          <View className="mt-7 gap-3">
            {APPLE_ENABLED ? (
              <Pressable
                className={`h-[52px] flex-row items-center justify-center rounded-full border border-hair bg-raise ${
                  busy ? 'opacity-40' : ''
                }`}
                disabled={busy}
                onPress={() => handleOAuth('apple')}
                accessibilityRole="button"
                accessibilityLabel={t('auth.apple.cta', locale)}
              >
                {oauthBusy === 'apple' ? (
                  <ActivityIndicator color={semantic.foreground} />
                ) : (
                  <Text className="font-semibold text-foreground">
                    {t('auth.apple.cta', locale)}
                  </Text>
                )}
              </Pressable>
            ) : null}

            {GOOGLE_ENABLED ? (
              <Pressable
                className={`h-[52px] flex-row items-center justify-center rounded-full border border-hair bg-raise ${
                  busy ? 'opacity-40' : ''
                }`}
                disabled={busy}
                onPress={() => handleOAuth('google')}
                accessibilityRole="button"
                accessibilityLabel={t('auth.google.cta', locale)}
              >
                {oauthBusy === 'google' ? (
                  <ActivityIndicator color={semantic.foreground} />
                ) : (
                  <Text className="font-semibold text-foreground">
                    {t('auth.google.cta', locale)}
                  </Text>
                )}
              </Pressable>
            ) : null}
          </View>

          <View className="my-6 flex-row items-center gap-3">
            <View className="h-px flex-1 bg-hair" />
            <SectionLabel tone="muted">{t('auth.orEmail', locale)}</SectionLabel>
            <View className="h-px flex-1 bg-hair" />
          </View>
        </>
      ) : (
        <View className="mt-7" />
      )}

      <View className="gap-4">
        {!login ? (
          <View className="gap-2">
            <Text className="text-xs font-medium text-muted-foreground">
              {t('auth.name.label', locale)}
            </Text>
            <TextInput
              className="rounded-full border border-hair bg-raise px-5 py-4 text-foreground"
              autoCapitalize="words"
              autoComplete="name"
              placeholder={t('auth.name.placeholder', locale)}
              value={name}
              onChangeText={setName}
            />
          </View>
        ) : null}

        <View className="gap-2">
          <Text className="text-xs font-medium text-muted-foreground">
            {t('auth.email.label', locale)}
          </Text>
          <TextInput
            className="rounded-full border border-hair bg-raise px-5 py-4 text-foreground"
            autoCapitalize="none"
            autoComplete="email"
            inputMode="email"
            placeholder={t('auth.email.placeholder', locale)}
            value={email}
            onChangeText={setEmail}
          />
        </View>

        <View className="gap-2">
          <Text className="text-xs font-medium text-muted-foreground">
            {t('auth.password.label', locale)}
          </Text>
          <TextInput
            className="rounded-full border border-hair bg-raise px-5 py-4 text-foreground"
            autoCapitalize="none"
            autoComplete={login ? 'current-password' : 'new-password'}
            secureTextEntry
            placeholder={t('auth.password.placeholder', locale)}
            value={password}
            onChangeText={setPassword}
          />
          {/* Signup only — the rule is stated once before typing, then becomes a
              live checklist. `success`, not `aura`: a satisfied form rule is a
              confirmation, not a moment (rule 4). Met/unmet is carried by the
              mark and by an explicit SR label, not by colour alone (G2). */}
          {!login && password.length === 0 ? (
            <Text className="px-5 text-xs text-muted-foreground">
              {t('auth.password.hint', locale)}
            </Text>
          ) : null}
          {!login && password.length > 0 ? (
            <View className="gap-1 px-5">
              {PASSWORD_REQUIREMENTS.map((requirement) => {
                const met = !unmet.includes(requirement);
                const label = t(`auth.password.req.${requirement}`, locale);
                return (
                  <Text
                    key={requirement}
                    className={`text-xs ${met ? 'text-success' : 'text-muted-foreground'}`}
                    accessibilityLabel={`${t(met ? 'a11y.req.met' : 'a11y.req.unmet', locale)} ${label}`}
                  >
                    {met ? '✓' : '•'} {label}
                  </Text>
                );
              })}
            </View>
          ) : null}
        </View>

        {error ? <Text className="text-sm text-error">{error}</Text> : null}
        {notice ? <Text className="text-sm text-aura">{notice}</Text> : null}
      </View>

      <Pressable
        className={`mt-7 h-[52px] items-center justify-center rounded-full bg-aura ${disabled ? 'opacity-40' : ''}`}
        disabled={disabled}
        onPress={submit}
        accessibilityRole="button"
        accessibilityLabel={t(login ? 'auth.login.cta' : 'auth.signup.cta', locale)}
      >
        {submitting ? (
          <ActivityIndicator color={semantic.onAura} />
        ) : (
          <Text className="text-[13px] font-semibold tracking-[0.14em] text-on-aura">
            {t(login ? 'auth.login.cta' : 'auth.signup.cta', locale)}
          </Text>
        )}
      </Pressable>

      <Pressable
        className="mt-6 items-center"
        onPress={toggleMode}
        accessibilityRole="button"
        hitSlop={8}
      >
        <Text className="text-[13px] text-muted-foreground">
          {t(login ? 'auth.noAccount' : 'auth.haveAccount', locale)}
        </Text>
      </Pressable>
    </ScrollView>
  );
}
