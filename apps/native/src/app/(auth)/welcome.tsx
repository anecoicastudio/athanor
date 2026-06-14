import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator } from 'react-native';
import { t, type MessageKey } from '@auria/i18n';
import { semantic } from '@auria/config';
import { Pressable, Text, TextInput, View } from '@/tw';
import { deviceLocale } from '@/lib/locale';
import { supabase } from '@/lib/supabase';

export default function WelcomeScreen() {
  const { mode } = useLocalSearchParams<{ mode?: string }>();
  const login = mode === 'login'; // copy-only branch: existing-user sign-in vs new-account creation
  const [email, setEmail] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const locale = deviceLocale;

  const copy = (suffix: 'eyebrow' | 'display' | 'sub') =>
    t(`${login ? 'auth.login' : 'auth.welcome'}.${suffix}` as MessageKey, locale);

  // OTP code flow: no emailRedirectTo → Supabase sends a 6-digit code
  // (the email template renders {{ .Token }}). The user types it on the
  // next screen. No deep link, no web round-trip.
  const sendCode = async () => {
    setSending(true);
    setError(null);
    const { error: err } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { shouldCreateUser: true },
    });
    setSending(false);
    if (err) {
      setError(t('auth.error.generic', locale));
      return;
    }
    router.push({ pathname: '/(auth)/check-email', params: { email: email.trim() } });
  };

  const disabled = sending || !email.includes('@');

  return (
    <View className="flex-1 justify-center gap-8 bg-background px-7">
      {router.canGoBack() ? (
        <Pressable
          className="absolute left-6 top-16"
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel={t('common.back', locale)}
          hitSlop={12}
        >
          <Text className="text-2xl text-foreground">‹</Text>
        </Pressable>
      ) : null}

      <View className="gap-2">
        <Text className="text-[11px] font-semibold uppercase tracking-[0.16em] text-aura">
          {copy('eyebrow')}
        </Text>
        <Text className="text-[28px] font-bold tracking-[-0.02em] text-foreground">
          {copy('display')}
        </Text>
        <Text className="text-sm text-muted-foreground">{copy('sub')}</Text>
      </View>

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
        {error ? <Text className="text-sm text-error">{error}</Text> : null}
      </View>

      <Pressable
        className={`h-[52px] items-center justify-center rounded-full bg-aura ${disabled ? 'opacity-40' : ''}`}
        disabled={disabled}
        onPress={sendCode}
        accessibilityRole="button"
        accessibilityLabel={t('auth.email.cta', locale)}
      >
        {sending ? (
          <ActivityIndicator color={semantic.onAura} />
        ) : (
          <Text className="font-semibold tracking-widest text-on-aura">
            {t('auth.email.cta', locale)}
          </Text>
        )}
      </Pressable>
    </View>
  );
}
