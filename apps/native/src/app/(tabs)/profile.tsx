import { useCallback, useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { auraKeys, starKeys } from '@athanor/api';
import { t } from '@athanor/i18n';
import type { Profile } from '@athanor/schemas';
import { Share } from 'react-native';
import { semantic } from '@athanor/config';
import { Pressable, ScrollView, Text, View } from '@/tw';
import { HIT_SLOP } from '@/lib/a11y';
import { KeyboardAvoiding } from '@/components/KeyboardAvoiding';
import { Screen } from '@/components/Screen';
import { SettingsIcon } from '@/components/glyphs';
import { useToast } from '@/components/ToastHost';
import { DreamSection } from '@/components/profile/DreamSection';
import { MomentFlash } from '@/components/profile/MomentFlash';
import { ProfileEditForm } from '@/components/profile/ProfileEditForm';
import { ProfileView } from '@/components/profile/ProfileView';
import { useAuth } from '@/lib/auth-context';
import { profileShareMessage } from '@/lib/profile-share';
import { useLocale } from '@/hooks/use-locale';
import { useOwnDream } from '@/hooks/use-own-dream';
import { useStarCelebration } from '@/hooks/use-star-celebration';

/**
 * Profilo Evolutivo — own authenticated view (PRD §4.2, M1): view + inline edit
 * of bio / identity / seeking / locale + per-field visibility, dream read-only
 * (editor is M2) with its own visibility control, Six Stars grid seeded from
 * Aura snapshot (score engine M6).
 * Per-field visibility is enforced in the DB (M10, migration 20260807170813):
 * hidden fields never leave Postgres.
 * `?edit=1` opens straight in edit mode — the trust modal's «Chi vede il mio
 * sogno» row deep-links here.
 */
export default function ProfileScreen() {
  const { profile, session, refreshProfile } = useAuth();

  if (!profile || !session) {
    return (
      <Screen className="items-center justify-center">
        <Text
          className="text-2xl text-muted-foreground"
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          ✦
        </Text>
      </Screen>
    );
  }

  return (
    <ProfileEditor userId={session.user.id} profile={profile} refreshProfile={refreshProfile} />
  );
}

function ProfileEditor({
  userId,
  profile,
  refreshProfile,
}: {
  userId: string;
  profile: Profile;
  refreshProfile: () => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [saved, setSaved] = useState(false);
  const { showToast } = useToast();
  const router = useRouter();
  const queryClient = useQueryClient();
  const locale = useLocale();

  const dream = useOwnDream(userId);
  const { starFlash } = useStarCelebration(userId, locale);

  // `?edit=1` deep-link (trust modal → «Chi vede il mio sogno»). Consumed in an
  // effect, not a useState initializer: trust dismissTo's back to this already-
  // mounted tab, so only the params change — an initializer would never re-run.
  const { edit } = useLocalSearchParams<{ edit?: string }>();
  useEffect(() => {
    if (edit !== '1') return;
    setEditing(true);
    router.setParams({ edit: undefined });
  }, [edit, router]);

  // Invalidate Aura + Stars whenever Profilo regains focus so the grid refreshes
  // after confirmed help events (preserves focus-refetch behaviour from old useEffect).
  useFocusEffect(
    useCallback(() => {
      void queryClient.invalidateQueries({ queryKey: auraKeys.score(userId) });
      void queryClient.invalidateQueries({ queryKey: starKeys.list(userId) });
    }, [userId, queryClient]),
  );

  // Native share sheet, via the one builder both profile surfaces use (issue #110). Built at
  // render so the ✦ can be withheld when there is nothing to share: handle is nullable and
  // the signup trigger does not set it, so a session can reach this screen without one.
  // Tracked-referral attribution is a later milestone.
  const shareMessage = profileShareMessage(profile.handle, t('app.name', locale));

  const shareProfile = async () => {
    if (!shareMessage) return;
    try {
      const { action } = await Share.share({ message: shareMessage });
      if (action === Share.sharedAction) {
        showToast(t('profile.share.done', locale), 'success');
      }
    } catch {
      // user dismissed or share unavailable — no-op
    }
  };

  const onSaved = () => {
    setEditing(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  };

  return (
    // #614 beyond-the-issue: that issue's out-of-scope note read this screen as a
    // top-anchored search field, which it is not. `ProfileEditForm`'s name/bio/mission fields sit well down the scroll,
    // so it had the same defect and takes the same primitive, outside `Screen`.
    <KeyboardAvoiding>
      <Screen>
        <ScrollView
          className="flex-1"
          contentContainerClassName="gap-8 px-5 pb-12 pt-4"
          keyboardShouldPersistTaps="handled"
        >
          {!editing ? (
            <>
              {/* Header row: share + edit toggle — sized to the 24px icon scale
              (tab glyphs / modal chevrons), HIT_SLOP like HomeHeader. gap-6 (24px)
              keeps adjacent hit rects clear of each other: HIT_SLOP adds 11px per
              side, so anything under 22px overlaps and taps cross-fire. */}
              <View className="flex-row items-center justify-end gap-6">
                {shareMessage != null && (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={t('profile.share.label', locale)}
                    hitSlop={HIT_SLOP}
                    onPress={() => void shareProfile()}
                  >
                    <Text className="text-2xl text-aura">✦</Text>
                  </Pressable>
                )}
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t('settings.title', locale)}
                  hitSlop={HIT_SLOP}
                  onPress={() => router.push('/(modal)/settings')}
                >
                  <SettingsIcon size={24} color={semantic.faint} />
                </Pressable>
                <Pressable
                  onPress={() => setEditing(true)}
                  accessibilityRole="button"
                  hitSlop={HIT_SLOP}
                >
                  <Text className="text-base font-semibold text-faint">
                    {t('profile.edit', locale)}
                  </Text>
                </Pressable>
              </View>

              <ProfileView
                userId={userId}
                profile={profile}
                locale={locale}
                hasDream={dream.dreamText != null}
                dreamSlot={<DreamSection locale={locale} dream={dream} />}
              />
            </>
          ) : (
            <ProfileEditForm
              userId={userId}
              profile={profile}
              dreamText={dream.dreamText}
              refreshProfile={refreshProfile}
              onSaved={onSaved}
              onCancel={() => setEditing(false)}
            />
          )}

          {saved ? (
            <Text className="text-sm text-success">{t('profile.saved', locale)}</Text>
          ) : null}

          {/* The one glow moment (rule #4): a help became real. Reduced-motion safe (§9). */}
          <MomentFlash visible={dream.flashMilestoneId != null} locale={locale} />

          {/* Star-earned flash (rule #4): a new star was lit — uses MomentFlash.
          The matching toast fires through the global host (#117). */}
          <MomentFlash visible={starFlash} locale={locale} />
        </ScrollView>
      </Screen>
    </KeyboardAvoiding>
  );
}
