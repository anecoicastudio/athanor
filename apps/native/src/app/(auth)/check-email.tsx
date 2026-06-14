import { useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator } from 'react-native';
import { t } from '@athanor/i18n';
import { semantic } from '@athanor/config';
import { Pressable, Text, TextInput, View } from '@/tw';
import { deviceLocale } from '@/lib/locale';
import { supabase } from '@/lib/supabase';

export default function CheckEmailScreen() {
  const { email } = useLocalSearchParams<{ email: string }>();
  const [code, setCode] = useState('');
  const [wait, setWait] = useState(60);
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const locale = deviceLocale;

  useEffect(() => {
    if (wait <= 0) return;
    const id = setInterval(() => setWait((s) => s - 1), 1000);
    return () => clearInterval(id);
  }, [wait]);

  // verifyOtp sets the session client-side → onAuthStateChange in auth-context
  // fires → the AuthGuard in _layout.tsx routes on to onboarding or the tabs.
  // No manual navigation here.
  const verify = async () => {
    if (!email || code.length !== 6) return;
    setVerifying(true);
    setError(null);
    const { error: err } = await supabase.auth.verifyOtp({
      email,
      token: code.trim(),
      type: 'email',
    });
    setVerifying(false);
    if (err) setError(t('auth.codeInvalid', locale));
  };

  const resend = async () => {
    if (!email) return;
    setError(null);
    const { error: err } = await supabase.auth.signInWithOtp({
      email,
      options: { shouldCreateUser: true },
    });
    if (err) {
      setError(t('auth.error.generic', locale));
      return;
    }
    setWait(60);
  };

  const disabled = verifying || code.length !== 6;

  return (
    <View className="flex-1 justify-center gap-6 bg-background px-7">
      <View className="gap-2">
        <Text className="text-[28px] font-bold tracking-[-0.02em] text-foreground">
          {t('auth.sent.title', locale)}
        </Text>
        <Text className="text-sm text-muted-foreground">{t('auth.codeSent', locale)}</Text>
      </View>

      <View className="gap-2">
        <Text className="text-xs font-medium text-muted-foreground">
          {t('auth.codeLabel', locale)}
        </Text>
        <TextInput
          className="rounded-ctl border border-hair bg-raise px-5 py-4 text-center text-2xl tracking-[0.4em] text-foreground"
          keyboardType="number-pad"
          inputMode="numeric"
          maxLength={6}
          autoComplete="one-time-code"
          textContentType="oneTimeCode"
          placeholder={t('auth.codePlaceholder', locale)}
          value={code}
          onChangeText={(v) => setCode(v.replace(/\D/g, ''))}
        />
        {error ? <Text className="text-sm text-error">{error}</Text> : null}
      </View>

      <Pressable
        className={`h-[52px] items-center justify-center rounded-full bg-aura ${disabled ? 'opacity-40' : ''}`}
        disabled={disabled}
        onPress={verify}
        accessibilityRole="button"
        accessibilityLabel={t('auth.verify', locale)}
      >
        {verifying ? (
          <ActivityIndicator color={semantic.onAura} />
        ) : (
          <Text className="font-semibold tracking-widest text-on-aura">
            {t('auth.verify', locale)}
          </Text>
        )}
      </Pressable>

      <Pressable disabled={wait > 0} onPress={resend} accessibilityRole="button">
        <Text
          className={
            wait > 0 ? 'text-muted-foreground underline opacity-60' : 'text-muted-foreground underline'
          }
        >
          {wait > 0
            ? t('auth.sent.wait', locale, { seconds: wait })
            : t('auth.sent.resend', locale)}
        </Text>
      </Pressable>
    </View>
  );
}
