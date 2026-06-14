import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator } from 'react-native';
import { t, type MessageKey } from '@athanor/i18n';
import { semantic } from '@athanor/config';
import { Pressable, ScrollView, Text, TextInput, View } from '@/tw';
import { deviceLocale } from '@/lib/locale';
import { signInWithProvider } from '@/lib/oauth';
import { supabase } from '@/lib/supabase';

// Well-formed check (UX gate only) — the real validity verdict is Supabase's.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD = 8;

// Apple sign-in needs the Supabase Apple provider, which requires a paid Apple
// Developer account (Services ID + key) — not yet configured. Flip to true once it
// is; the code path is provider-agnostic and needs no other change.
const APPLE_ENABLED = false;

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
      }
      return;
    }
    // `display_name` lives in auth.users.user_metadata for now — `profiles` has no
    // name column yet (deferred to M2's @handle page; add a column + flush then).
    // It's retrievable via session.user.user_metadata.display_name in the meantime.
    const { data, error: err } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: { data: { display_name: name.trim() } },
    });
    setSubmitting(false);
    if (err) {
      if (__DEV__) console.warn('[auth] signUp', err.status, err.code, err.message);
      setError(t(authErrorKey(err), locale));
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
      setError(t('auth.error.generic', locale));
    }
  };

  const busy = submitting || oauthBusy !== null;
  const disabled =
    busy || !EMAIL_RE.test(email.trim()) || password.length < MIN_PASSWORD;

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
        <Text className="text-[11px] font-semibold uppercase tracking-[0.16em] text-aura">
          {copy('eyebrow')}
        </Text>
        <Text className="text-[28px] font-bold tracking-[-0.02em] text-foreground">
          {copy('display')}
        </Text>
        <Text className="text-sm text-muted-foreground">{copy('sub')}</Text>
      </View>

      {/* OAuth on top, per the prototype. Apple hidden until its provider is configured. */}
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
              <Text className="font-semibold text-foreground">{t('auth.apple.cta', locale)}</Text>
            )}
          </Pressable>
        ) : null}

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
            <Text className="font-semibold text-foreground">{t('auth.google.cta', locale)}</Text>
          )}
        </Pressable>
      </View>

      <View className="my-6 flex-row items-center gap-3">
        <View className="h-px flex-1 bg-hair" />
        <Text className="text-[11px] uppercase tracking-widest text-muted-foreground">
          {t('auth.orEmail', locale)}
        </Text>
        <View className="h-px flex-1 bg-hair" />
      </View>

      <View className="gap-4">
        {!login ? (
          <View className="gap-2">
            <Text className="text-xs font-medium text-muted-foreground">
              {t('auth.name.label', locale)}
            </Text>
            <TextInput
              className="rounded-ctl border border-hair bg-raise px-4 py-4 text-foreground"
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
            className="rounded-ctl border border-hair bg-raise px-4 py-4 text-foreground"
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
            className="rounded-ctl border border-hair bg-raise px-4 py-4 text-foreground"
            autoCapitalize="none"
            autoComplete={login ? 'current-password' : 'new-password'}
            secureTextEntry
            placeholder={t('auth.password.placeholder', locale)}
            value={password}
            onChangeText={setPassword}
          />
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
          <Text className="font-semibold tracking-widest text-on-aura">
            {t(login ? 'auth.login.cta' : 'auth.signup.cta', locale)}
          </Text>
        )}
      </Pressable>

      <Pressable className="mt-6 items-center" onPress={toggleMode} accessibilityRole="button" hitSlop={8}>
        <Text className="text-[13px] text-muted-foreground">
          {t(login ? 'auth.noAccount' : 'auth.haveAccount', locale)}
        </Text>
      </Pressable>
    </ScrollView>
  );
}
