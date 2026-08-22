import { useEffect } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { setPendingReferral } from '@/lib/referral';
import { useAuth } from '@/lib/auth-context';
import { LoadingScreen } from '@/components/LoadingScreen';

/** Deep-link catcher: stash the code, then hand off to the normal entry flow. */
export default function InviteCatchScreen() {
  const { code } = useLocalSearchParams<{ code: string }>();
  const { session } = useAuth();
  const router = useRouter();

  useEffect(() => {
    void (async () => {
      if (code && !session) await setPendingReferral(code);
      router.replace(session ? '/(tabs)' : '/(auth)/welcome');
    })();
  }, [code, session, router]);

  return <LoadingScreen />;
}
