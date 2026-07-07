import { useEffect, useState } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { getProfileIdByHandle } from '@athanor/api';
import { t } from '@athanor/i18n';
import { handleSchema } from '@athanor/schemas';
import { Pressable, Text, View } from '@/tw';
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
  const { session, profile, loading } = useAuth();
  const router = useRouter();
  const [unavailable, setUnavailable] = useState(false);

  const locale = profile?.locale ?? 'it';
  const userId = session?.user.id ?? null;

  useEffect(() => {
    if (loading) return;
    if (!userId) {
      router.replace('/(auth)/welcome');
      return;
    }
    if (!raw?.startsWith('@')) {
      setUnavailable(true);
      return;
    }
    const parsed = handleSchema.safeParse(raw.slice(1).toLowerCase());
    if (!parsed.success) {
      setUnavailable(true);
      return;
    }
    let cancelled = false;
    getProfileIdByHandle(supabase, parsed.data)
      .then((id) => {
        if (cancelled) return;
        if (id) {
          router.replace({ pathname: '/(modal)/user/[id]', params: { id } });
        } else {
          setUnavailable(true);
        }
      })
      .catch(() => {
        if (!cancelled) setUnavailable(true);
      });
    return () => {
      cancelled = true;
    };
  }, [loading, userId, raw, router]);

  if (unavailable) {
    return (
      <View className="flex-1 items-center justify-center gap-6 bg-background px-8">
        <Text className="text-center text-base text-muted-foreground">
          {t('profile.unavailable', locale)}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('notFound.home', locale)}
          onPress={() => router.replace('/(tabs)')}
          className="min-h-[44px] items-center justify-center rounded-full border border-hair bg-raise px-6"
        >
          <Text className="text-sm font-semibold text-foreground">
            {t('notFound.home', locale)}
          </Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View className="flex-1 items-center justify-center bg-background">
      <Text className="text-2xl text-muted-foreground">✦</Text>
    </View>
  );
}
