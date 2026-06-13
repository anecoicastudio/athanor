import { useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator } from 'react-native';
import { t } from '@auria/i18n';
import { Pressable, Text, TextInput, View } from '@/tw';
import { supabase } from '@/lib/supabase';

export default function CheckEmailScreen() {
  const { email } = useLocalSearchParams<{ email: string }>();
  const [code, setCode] = useState('');
  const [wait, setWait] = useState(60);
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    if (err) setError(t('auth.codeInvalid', 'it'));
  };

  const resend = async () => {
    if (!email) return;
    setError(null);
    const { error: err } = await supabase.auth.signInWithOtp({
      email,
      options: { shouldCreateUser: true },
    });
    if (err) {
      setError(t('auth.error.generic', 'it'));
      return;
    }
    setWait(60);
  };

  return (
    <View className="flex-1 justify-center gap-4 bg-background px-5">
      <Text className="text-3xl text-foreground">{t('auth.sent.title', 'it')}</Text>
      <Text className="text-muted-foreground">{t('auth.codeSent', 'it')}</Text>

      <View className="gap-2">
        <Text className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          {t('auth.codeLabel', 'it')}
        </Text>
        <TextInput
          className="rounded-full border border-line bg-surface px-5 py-4 text-center text-2xl tracking-[0.4em] text-foreground"
          keyboardType="number-pad"
          inputMode="numeric"
          maxLength={6}
          autoComplete="one-time-code"
          textContentType="oneTimeCode"
          placeholder={t('auth.codePlaceholder', 'it')}
          value={code}
          onChangeText={(v) => setCode(v.replace(/\D/g, ''))}
        />
        {error ? <Text className="text-sm text-error">{error}</Text> : null}
      </View>

      <Pressable
        className={
          verifying || code.length !== 6
            ? 'h-[52px] items-center justify-center rounded-full bg-foreground opacity-40'
            : 'h-[52px] items-center justify-center rounded-full bg-foreground'
        }
        disabled={verifying || code.length !== 6}
        onPress={verify}
        accessibilityRole="button"
      >
        {verifying ? (
          <ActivityIndicator />
        ) : (
          <Text className="font-semibold tracking-widest text-background">
            {t('auth.verify', 'it')}
          </Text>
        )}
      </Pressable>

      <Pressable disabled={wait > 0} onPress={resend} accessibilityRole="button">
        <Text
          className={
            wait > 0
              ? 'text-muted-foreground underline opacity-60'
              : 'text-muted-foreground underline'
          }
        >
          {wait > 0
            ? t('auth.sent.wait', 'it').replace('{seconds}', String(wait))
            : t('auth.sent.resend', 'it')}
        </Text>
      </Pressable>
    </View>
  );
}
