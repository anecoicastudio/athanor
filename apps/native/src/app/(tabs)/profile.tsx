import { useCallback, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useFocusEffect, useRouter } from 'expo-router';
import { auraKeys, starKeys } from '@athanor/api';
import { t } from '@athanor/i18n';
import type { Profile } from '@athanor/schemas';
import { Share } from 'react-native';
import { Pressable, ScrollView, Text, View } from '@/tw';
import { HIT_SLOP } from '@/lib/a11y';
import { DreamSection } from '@/components/profile/DreamSection';
import { MomentFlash } from '@/components/profile/MomentFlash';
import { ProfileEditForm } from '@/components/profile/ProfileEditForm';
import { ProfileView } from '@/components/profile/ProfileView';
import { Toast } from '@/components/Toast';
import { useAuth } from '@/lib/auth-context';
import { useOwnDream } from '@/hooks/use-own-dream';
import { useStarCelebration } from '@/hooks/use-star-celebration';

/**
 * Profilo Evolutivo — own authenticated view (PRD §4.2, M1): view + inline edit
 * of bio / identity / seeking / locale + per-field visibility, dream read-only
 * (editor is M2), Six Stars grid seeded from Aura snapshot (score engine M6).
 * Per-field visibility is enforced in the DB (M10, migration 20260807170813):
 * hidden fields never leave Postgres. The 'dream' key has no toggle here yet.
 */
export default function ProfileScreen() {
  const { profile, session, refreshProfile } = useAuth();

  if (!profile || !session) {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <Text
          className="text-2xl text-muted-foreground"
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          ✦
        </Text>
      </View>
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
  const router = useRouter();
  const queryClient = useQueryClient();
  const locale = profile.locale;

  const dream = useOwnDream(userId);
  const { starToast, starFlash } = useStarCelebration(userId, locale);

  // Invalidate Aura + Stars whenever Profilo regains focus so the grid refreshes
  // after confirmed help events (preserves focus-refetch behaviour from old useEffect).
  useFocusEffect(
    useCallback(() => {
      void queryClient.invalidateQueries({ queryKey: auraKeys.score(userId) });
      void queryClient.invalidateQueries({ queryKey: starKeys.list(userId) });
    }, [userId, queryClient]),
  );

  // Native share sheet: shares the @handle + app name (mirrors home InviteCard;
  // tracked-referral attribution is a later milestone).
  const shareProfile = async () => {
    const handle = profile.handle;
    const message = handle ? `@${handle} — ${t('app.name', locale)}` : t('app.name', locale);
    try {
      await Share.share({ message });
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
    <ScrollView
      className="flex-1 bg-background"
      contentContainerClassName="gap-8 px-5 py-12"
      keyboardShouldPersistTaps="handled"
    >
      {!editing ? (
        <>
          {/* Header row: share stub + edit toggle — sized to the 24px icon scale
              (tab glyphs / modal chevrons), HIT_SLOP like HomeHeader. */}
          <View className="flex-row items-center justify-end gap-5">
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('profile.share.toast', locale)}
              hitSlop={HIT_SLOP}
              onPress={() => void shareProfile()}
            >
              <Text className="text-2xl text-aura">✦</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('settings.title', locale)}
              hitSlop={HIT_SLOP}
              onPress={() => router.push('/(modal)/settings')}
            >
              <Text className="text-2xl text-faint">⚙</Text>
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
          refreshProfile={refreshProfile}
          onSaved={onSaved}
          onCancel={() => setEditing(false)}
        />
      )}

      {saved ? <Text className="text-sm text-success">{t('profile.saved', locale)}</Text> : null}

      {/* The one glow moment (rule #4): a help became real. Reduced-motion safe (§9). */}
      <MomentFlash visible={dream.flashMilestoneId != null} locale={locale} />

      {/* Star-earned flash (rule #4): a new star was lit — uses MomentFlash. */}
      <MomentFlash visible={starFlash} locale={locale} />

      {/* Star-earned toast: transient inline surface (shared Toast recipe). */}
      {starToast ? <Toast label={starToast} /> : null}
    </ScrollView>
  );
}
