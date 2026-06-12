import * as Linking from 'expo-linking';
import { useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { t } from '@kaira/i18n';
import { Pressable, Text, View } from '@/tw';
import { supabase } from '@/lib/supabase';

export default function CheckEmailScreen() {
  const { email } = useLocalSearchParams<{ email: string }>();
  const [wait, setWait] = useState(60);

  useEffect(() => {
    if (wait <= 0) return;
    const id = setInterval(() => setWait((s) => s - 1), 1000);
    return () => clearInterval(id);
  }, [wait]);

  const resend = async () => {
    if (!email) return;
    setWait(60);
    await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: Linking.createURL('auth/callback') },
    });
  };

  return (
    <View className="flex-1 justify-center gap-4 bg-background px-5">
      <Text className="text-3xl text-foreground">{t('auth.sent.title', 'it')}</Text>
      <Text className="text-muted-foreground">{t('auth.sent.body', 'it')}</Text>
      <Pressable disabled={wait > 0} onPress={resend} accessibilityRole="button">
        <Text className="text-muted-foreground underline">
          {wait > 0
            ? t('auth.sent.wait', 'it').replace('{seconds}', String(wait))
            : t('auth.sent.resend', 'it')}
        </Text>
      </Pressable>
    </View>
  );
}
