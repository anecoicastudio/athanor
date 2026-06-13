import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator } from 'react-native';
import { t } from '@auria/i18n';
import { Pressable, Text, TextInput, View } from '@/tw';
import { supabase } from '@/lib/supabase';

export default function WelcomeScreen() {
  const [email, setEmail] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

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
      setError(t('auth.error.generic', 'it'));
      return;
    }
    router.push({ pathname: '/(auth)/check-email', params: { email: email.trim() } });
  };

  return (
    <View className="flex-1 justify-center gap-6 bg-background px-5">
      <Text className="text-4xl text-foreground">{t('auth.welcome.title', 'it')}</Text>
      <View className="gap-2">
        <Text className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          {t('auth.email.label', 'it')}
        </Text>
        <TextInput
          className="rounded-full border border-line bg-surface px-5 py-4 text-foreground"
          autoCapitalize="none"
          autoComplete="email"
          inputMode="email"
          placeholder={t('auth.email.placeholder', 'it')}
          value={email}
          onChangeText={setEmail}
        />
        {error ? <Text className="text-sm text-error">{error}</Text> : null}
      </View>
      <Pressable
        className={
          sending || !email.includes('@')
            ? 'h-[52px] items-center justify-center rounded-full bg-foreground opacity-40'
            : 'h-[52px] items-center justify-center rounded-full bg-foreground'
        }
        disabled={sending || !email.includes('@')}
        onPress={sendCode}
        accessibilityRole="button"
      >
        {sending ? (
          <ActivityIndicator />
        ) : (
          <Text className="font-semibold tracking-widest text-background">
            {t('auth.email.cta', 'it')}
          </Text>
        )}
      </Pressable>
    </View>
  );
}
