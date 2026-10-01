import { useEffect, useMemo, useRef, useState } from 'react';
import { claimHandle, handleClaimRefusal, isHandleTaken } from '@athanor/api';
import { classifyHandle, suggestHandles } from '@athanor/core';
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
import { firstFreeHandle } from '@/lib/handle-suggestion';
import { supabase } from '@/lib/supabase';

/**
 * The @handle step (#782) — the last one, and the only one AFTER the account exists.
 *
 * Marco's ruling (2026-09-19): the person chooses their handle; it is never the email's local
 * part, not even as a prefilled suggestion. It sits here rather than in the pre-auth funnel or on
 * the sign-up form because this is the one screen every sign-up path reaches — email and
 * password, Google and Apple (which skip the sign-up form and its name field), and a first
 * sign-in on a new device — and because with a session the availability check is an ordinary
 * members read. A funnel-time check would have needed a lookup anyone could call signed-out.
 *
 * Marco's ruling (2026-10-01, #908) relaxes one half of that, and only that half: the field may
 * open on a handle SUGGESTED from the name the person already gave — `profiles.display_name`,
 * which `handle_new_user()` fills from Apple's or Google's name or the sign-up form's. Never from
 * the email; `suggestHandles` refuses anything carrying an `@`. App Review read the empty,
 * mandatory field after Sign in with Apple as asking again for a name Apple had just provided
 * (Guideline 4, submission `4cb70b1c`, 2026-10-01); with a suggestion the step is one tap, and
 * the field is still the person's to change. No name, or no free shape of it → the empty field,
 * as before. The branch is on the NAME, never on the provider.
 *
 * AuthGuard routes here whenever the funnel's answers have landed and `profiles.handle` is still
 * NULL (`nextOnboardingStep`), and away again once the claim lands — this screen never navigates
 * itself. The first choice starts no rename clock (`profiles_handle_cooldown` ignores a change
 * from NULL), so a mistype here is fixable from the profile at once.
 */
export default function HandleStepScreen() {
  const { session, profile, refreshProfile } = useAuth();
  const locale = useLocale();
  const userId = session?.user.id ?? null;
  const [handle, setHandle] = useState('');
  // The handle this screen offered, while it is still what the field holds.
  const [suggested, setSuggested] = useState<string | null>(null);
  // Set by the first keystroke: a suggestion that answers late never overwrites what was typed.
  const typed = useRef(false);

  const displayName = profile?.display_name ?? null;
  const candidates = useMemo(() => suggestHandles(displayName), [displayName]);
  useEffect(() => {
    if (candidates.length === 0) return;
    let cancelled = false;
    void firstFreeHandle(candidates, (candidate) => isHandleTaken(supabase, candidate)).then(
      (free) => {
        if (cancelled || free === null || typed.current) return;
        setSuggested(free);
        setHandle(free);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [candidates]);

  const onChangeHandle = (next: string) => {
    typed.current = true;
    setHandle(next);
  };
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
              <Text className="text-muted-foreground">
                {t(
                  suggested !== null && suggested === handle
                    ? 'onboarding.handle.subSuggested'
                    : 'onboarding.handle.sub',
                  locale,
                )}
              </Text>
              <HandleField
                value={handle}
                onChangeText={onChangeHandle}
                status={status}
                locale={locale}
                refusal={refusalNow}
                // With a name to suggest from, the keyboard stays down: the suggestion and the
                // button are the screen, and the field is one tap away for whoever wants another.
                autoFocus={candidates.length === 0}
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
