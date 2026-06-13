import * as Linking from 'expo-linking';
import { useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { t } from '@auria/i18n';
import { Pressable, Text, View } from '@/tw';
import { supabase } from '@/lib/supabase';

export default function CheckEmailScreen() {
  const { email } = useLocalSearchParams<{ email: string }>();
  const [wait, setWait] = useState(60);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (wait <= 0) return;
    const id = setInterval(() => setWait((s) => s - 1), 1000);
    return () => clearInterval(id);
  }, [wait]);

  const resend = async () => {
    if (!email) return;
    setError(null);
    const { error: err } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: Linking.createURL('auth/callback') },
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
      <Text className="text-muted-foreground">{t('auth.sent.body', 'it')}</Text>
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
      {error ? <Text className="text-sm text-error">{error}</Text> : null}
    </View>
  );
}
