import { useEffect, useState } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { getProfileIdByHandle } from '@athanor/api';
import { t } from '@athanor/i18n';
import { handleSchema } from '@athanor/schemas';
import { Text, View } from '@/tw';
import { Screen } from '@/components/Screen';
import { LoadingScreen } from '@/components/LoadingScreen';
import { Button } from '@/components/Button';
import { useLocale } from '@/hooks/use-locale';
import { useAuth } from '@/lib/auth-context';
import { supabase } from '@/lib/supabase';

/**
 * @handle deep-link catcher (P4.3) — the mobile side of the public `@handle`
 * contract (frontend 02 §6). AASA + Android intent filters declare `/@*`;
 * this route resolves the handle to a profile id and hands off to the
 * existing person-detail. Mirrors the invite/[code] catcher: signed-out →
 * entry flow (no stash — re-open the link after sign-in, P4.1 funnel parity).
 * The leading `@` is REQUIRED: this root dynamic segment also catches random
 * unmatched paths, and those must never resolve as handles.
 */
export default function HandleCatchScreen() {
  const { handle: raw } = useLocalSearchParams<{ handle: string }>();
  const { session, loading } = useAuth();
  const router = useRouter();
  const [lookupFailed, setLookupFailed] = useState(false);

  const locale = useLocale();
  const userId = session?.user.id ?? null;

  // Whether the path is even a handle is knowable during render, so it is derived rather than
  // set from the effect below (#691). The leading `@` is REQUIRED — see the docblock. Only the
  // LOOKUP's answer needs state.
  const parsed = raw?.startsWith('@') ? handleSchema.safeParse(raw.slice(1).toLowerCase()) : null;
  const handle = parsed?.success ? parsed.data : null;
  // Withheld until the session has settled and turned out to be signed in: those two arms
  // redirect, and «questo profilo non è disponibile» is the wrong thing to flash on the way.
  const unavailable = !loading && !!userId && (handle === null || lookupFailed);

  useEffect(() => {
    if (loading) return;
    if (!userId) {
      router.replace('/(auth)/welcome');
      return;
    }
    if (!handle) return;
    let cancelled = false;
    getProfileIdByHandle(supabase, handle)
      .then((id) => {
        if (cancelled) return;
        if (id) {
          router.replace({ pathname: '/(modal)/user/[id]', params: { id } });
        } else {
          setLookupFailed(true);
        }
      })
      .catch(() => {
        if (!cancelled) setLookupFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [loading, userId, handle, router]);

  if (unavailable) {
    return (
      <Screen>
        <View className="flex-1 items-center justify-center gap-6 px-8">
          <Text className="text-center text-base text-muted-foreground">
            {t('profile.unavailable', locale)}
          </Text>
          <Button
            variant="outline"
            label={t('notFound.home', locale)}
            onPress={() => router.replace('/(tabs)')}
          />
        </View>
      </Screen>
    );
  }

  return <LoadingScreen />;
}
