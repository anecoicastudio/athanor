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

  // `?edit=1` deep-link (trust modal → «Chi vede il mio sogno»). Consumed in an effect, not a
  // useState initializer: trust `dismissTo`s back to this ALREADY-MOUNTED tab, so only the
  // params change — an initializer would never re-run.
  //
  // Nor can it be derived (#691). The param is a LEVEL with no per-push identity: the same
  // `'1'` means "open" on the first push and on the fifth, so any render-time expression that
  // remembers having closed it also refuses to reopen it, and one that does not remember shows
  // the editor again the frame after the member closed it. Observing that edge and consuming
  // it is what the effect is for, and it costs one commit per link.
  const { edit } = useLocalSearchParams<{ edit?: string }>();
  useEffect(() => {
    if (edit !== '1') return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
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

  /**
   * The tail both branches carry (#720). It used to sit inside the tab's own `ScrollView`,
   * below the view/edit ternary, so one copy served both modes. Edit mode now brings its own
   * scroll container — the «Annulla» row has to be a sticky child of the SAME ScrollView the
   * form scrolls in, which the tab cannot own from out here — so the tail travels as a slot
   * instead of being duplicated into `ProfileEditForm`.
   *
   * All three, not just the flashes: `saved` is only ever true with `editing` false today
   * (`onSaved` clears the mode and sets the flag together), so dropping it from the edit branch
   * would be invisible almost always — and wrong in the one window where it is not, a member
   * tapping «Modifica» again inside the 2.5s. A slot that carries the whole tail cannot drift
   * from the branch it mirrors.
   *
   * A fragment, so the three stay direct flex children of whichever content container receives
   * them and keep the `gap-8` rhythm. It is one child for `stickyHeaderIndices` accounting
   * (`React.Children.toArray` does not descend into fragments), which is why it may only ever
   * be appended LAST — see `ProfileEditForm`.
   *
   * One knowing cost. These used to sit BELOW the ternary, in a ScrollView that survived the
   * mode change, so they stayed mounted across it; now they live inside whichever branch is
   * rendered and remount when it flips. `MomentFlash` holds the episode it has already played
   * as local state, so a remount lets one replay: a star grant is held for 2800ms and the
   * flash plays out in ~700ms, so leaving edit mode inside that window shows the celebration a
   * second time. Cosmetic, and only reachable through `starFlash` — `flashMilestoneId` clears
   * at 700ms. Accepted rather than fixed: every alternative is worse. Hoisting the flashes out
   * of the branch moves them out of the scroll content in VIEW mode too, and lifting
   * `playedOut` into this screen would undo the reason #691 put it inside the component.
   */
  const tail = (
    <>
      {saved ? <Text className="text-sm text-success">{t('profile.saved', locale)}</Text> : null}

      {/* The one glow moment (rule #4): a help became real. Reduced-motion safe (§9). */}
      <MomentFlash flash={dream.flashMilestoneId} locale={locale} />

      {/* Star-earned flash (rule #4): a new star was lit — uses MomentFlash.
      The matching toast fires through the global host (#117). */}
      <MomentFlash flash={starFlash} locale={locale} />
    </>
  );

  return (
    // #614 beyond-the-issue: that issue's out-of-scope note read this screen as a
    // top-anchored search field, which it is not. `ProfileEditForm`'s name/bio/mission fields sit well down the scroll,
    // so it had the same defect and takes the same primitive, outside `Screen`.
    <KeyboardAvoiding>
      <Screen>
        {/* The branch is ABOVE the scroll container, not inside it (#720). Edit mode owns its
            own `ScrollView` so that its «Annulla» can be that view's sticky child; this one is
            the view mode's alone, and DESIGN §6's «one scroll axis per screen» holds because
            the two are branch-exclusive — closed here before the editor is ever mounted, never
            nested. `source-audit.test.ts` §39 pins that ordering. */}
        {!editing ? (
          <ScrollView
            className="flex-1"
            contentContainerClassName="gap-8 px-5 pb-12 pt-4"
            keyboardShouldPersistTaps="handled"
          >
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

            {tail}
          </ScrollView>
        ) : (
          <ProfileEditForm
            userId={userId}
            profile={profile}
            dreamText={dream.dreamText}
            refreshProfile={refreshProfile}
            onSaved={onSaved}
            onCancel={() => setEditing(false)}
            tailSlot={tail}
          />
        )}
      </Screen>
    </KeyboardAvoiding>
  );
}
