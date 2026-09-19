import { useState } from 'react';
import { claimHandle, handleClaimRefusal } from '@athanor/api';
import { classifyHandle } from '@athanor/core';
import { t } from '@athanor/i18n';
import { ScrollView, Text, View } from '@/tw';
import { Button } from '@/components/Button';
import { KeyboardAvoiding } from '@/components/KeyboardAvoiding';
import { Screen } from '@/components/Screen';
import { SectionLabel } from '@/components/SectionLabel';
import { HandleField } from '@/components/profile/HandleField';
import { useHandleLookup } from '@/hooks/use-handle-lookup';
import { useLocale } from '@/hooks/use-locale';
import { useAuth } from '@/lib/auth-context';
import { handleRefusalMessage, handleStatus, isHandleClaimable } from '@/lib/handle-status';
import { supabase } from '@/lib/supabase';

/**
 * The @handle step (#782) — the last one, and the only one AFTER the account exists.
 *
 * Marco's ruling (2026-09-19): the person chooses their handle; it is never the email's local
 * part, not even as a prefilled suggestion. It sits here rather than in the pre-auth funnel or on
 * the sign-up form because this is the one screen every sign-up path reaches — email and
 * password, Google (which skips the sign-up form and its name field), and a first sign-in on a
 * new device — and because with a session the availability check is an ordinary members read.
 * A funnel-time check would have needed a lookup anyone could call signed-out.
 *
 * AuthGuard routes here whenever the funnel's answers have landed and `profiles.handle` is still
 * NULL (`nextOnboardingStep`), and away again once the claim lands — this screen never navigates
 * itself. The first choice starts no rename clock (`profiles_handle_cooldown` ignores a change
 * from NULL), so a mistype here is fixable from the profile at once.
 */
export default function HandleStepScreen() {
  const { session, refreshProfile } = useAuth();
  const locale = useLocale();
  const userId = session?.user.id ?? null;
  const [handle, setHandle] = useState('');
  const [submitting, setSubmitting] = useState(false);
  // What the claim came back with, pinned to the candidate it was for: typing again clears it.
  const [refusal, setRefusal] = useState<{ candidate: string; message: string } | null>(null);

  const lookup = useHandleLookup(handle, classifyHandle(handle) === 'claimable');
  const status = handleStatus(handle, null, lookup);
  const refusalNow = refusal?.candidate === handle ? refusal.message : null;
  const canSubmit = isHandleClaimable(status) && refusalNow === null && !submitting;

  const submit = async () => {
    if (!userId || !canSubmit) return;
    setSubmitting(true);
    setRefusal(null);
    try {
      await claimHandle(supabase, userId, handle);
      // The guard routes on the re-read profile; nothing to navigate here.
      await refreshProfile();
    } catch (e) {
      const named = handleClaimRefusal(e);
      setRefusal({
        candidate: handle,
        message: named ? handleRefusalMessage(named, locale) : t('handle.error', locale),
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <KeyboardAvoiding>
      <Screen>
        <ScrollView
          className="flex-1"
          contentContainerClassName="grow px-5 pb-9 pt-4"
          keyboardShouldPersistTaps="handled"
        >
          {/* The funnel's top row is a 44pt back slot; there is nothing to go back to from here
              (the account exists), so the same height is held empty and the eyebrow sits in it. */}
          <View className="min-h-[44px] justify-center">
            <SectionLabel numberOfLines={1}>{t('onboarding.handle.eyebrow', locale)}</SectionLabel>
          </View>

          <View className="grow justify-center">
            <View className="gap-4">
              <Text
                accessibilityRole="header"
                className="text-[30px] font-bold tracking-[-0.02em] text-foreground"
              >
                {t('onboarding.handle.title', locale)}
              </Text>
              <Text className="text-muted-foreground">{t('onboarding.handle.sub', locale)}</Text>
              <HandleField
                value={handle}
                onChangeText={setHandle}
                status={status}
                locale={locale}
                refusal={refusalNow}
                autoFocus
                onSubmitEditing={() => void submit()}
              />
            </View>
          </View>

          <View className="mt-6">
            <Button
              variant="light"
              label={t('onboarding.next', locale)}
              accessibilityLabel={t('onboarding.next', locale)}
              disabled={!canSubmit}
              loading={submitting}
              onPress={() => void submit()}
            />
          </View>
        </ScrollView>
      </Screen>
    </KeyboardAvoiding>
  );
}
