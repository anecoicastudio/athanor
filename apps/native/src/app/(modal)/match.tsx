import { useEffect } from 'react';
import { Animated, Easing } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { t, type MessageKey } from '@athanor/i18n';
import { ScrollView, Text, View } from '@/tw';
import { useLocale } from '@/hooks/use-locale';
import { useAnimatedValue } from '@/hooks/use-animated-value';
import { useReducedMotion } from '@/hooks/use-reduced-motion';
import { CelebrationMark } from '@/components/CelebrationMark';
import { Button } from '@/components/Button';
import { HeaderClose } from '@/components/ModalHeader';
import { SectionLabel } from '@/components/SectionLabel';
import { MODAL_A11Y, useAnnounceOnMount } from '@/lib/a11y';
import { useGuardedBack } from '@/lib/modal-exit';
import { Screen } from '@/components/Screen';

/**
 * Match overlay — fired on a MUTUAL Momento match (the deck navigates here on a
 * matched accept). This is the one celebration screen of the swipe-deck slice
 * (rule 4 — a moment happened), and it is the composition every celebration shares (DESIGN
 * §2.3, §8.12; Galleria, 2026-10-07, #921): `CelebrationMark`, one cyan label, the h1, the
 * grey sentence and «✦ Aura» under it in the same grey, the cyan pill, then the outline pill.
 * No card, no glow, and no Aura number (rule 1). It scrolls because nothing here is capped.
 *
 * The screen fades in and the mark flashes once (DESIGN §10's one effect).
 * Reduced-motion safe: under Reduce Motion the screen fades opacity only (no
 * scale/transform), following the MomentFlash/AccessibilityInfo pattern.
 *
 * The «Apri il Momento» / «Scrivi a {name}» pill opens the freshly created
 * conversation (the deck forwards `conversationId` on a mutual match); with no
 * id it just dismisses. «Più tardi» / «Continua a esplorare» dismisses.
 *
 * All three exits go through `useGuardedBack` (#578). The in-app path is a push from the
 * Momenti tab, so `back()` works there — but this route is also reachable by a custom-scheme
 * link and on the expo-web QA harness, where it is the stack root and a bare `back()` is a
 * silent no-op. The fallback is the Momenti tab, which is where the deck lives.
 */
export default function MatchOverlay() {
  const locale = useLocale();
  const router = useRouter();
  const dismiss = useGuardedBack('/(tabs)/momenti');
  const {
    name = '',
    source = 'accepted',
    conversationId,
  } = useLocalSearchParams<{
    name: string;
    source: 'accepted' | 'incoming';
    conversationId?: string;
  }>();
  const accepted = source === 'accepted';
  const reduceMotion = useReducedMotion();
  const scale = useAnimatedValue(0.9);
  const opacity = useAnimatedValue(0);

  useEffect(() => {
    Animated.timing(opacity, { toValue: 1, duration: 200, useNativeDriver: true }).start();
    if (!reduceMotion) {
      Animated.sequence([
        Animated.timing(scale, {
          toValue: 1.15,
          duration: 320,
          easing: Easing.out(Easing.back(1.6)),
          useNativeDriver: true,
        }),
        Animated.timing(scale, { toValue: 1, duration: 220, useNativeDriver: true }),
      ]).start();
    } else {
      scale.setValue(1);
    }
  }, [reduceMotion, opacity, scale]);

  const fill = (k: MessageKey) => t(k, locale, { name });

  const headline = accepted ? t('match.accepted.big', locale) : name;
  useAnnounceOnMount(headline);

  return (
    <Animated.View {...MODAL_A11Y} style={{ opacity, flex: 1 }}>
      <Screen>
        {/* The close sits in normal flow so Screen owns the top inset (DESIGN §6 — never a
          hardcoded pt-*), on the screen's 20 gutter like every sheet's. */}
        <View className="flex-row justify-end px-5">
          <HeaderClose label={t('common.close', locale)} onPress={dismiss} />
        </View>

        <ScrollView contentContainerClassName="grow items-center justify-center gap-[26px] px-5 py-12">
          <Animated.View style={reduceMotion ? undefined : { transform: [{ scale }] }}>
            <CelebrationMark />
          </Animated.View>
          <View className="items-center gap-2">
            <SectionLabel tone="celebration">
              {accepted ? t('match.accepted.eyebrow', locale) : t('match.eyebrow', locale)}
            </SectionLabel>
            <Text accessibilityRole="header" className="text-center type-h1 text-foreground">
              {headline}
            </Text>
            <Text className="text-center type-small text-muted-foreground">
              {accepted ? fill('match.accepted.sub') : t('match.sub', locale)}
            </Text>
            <Text className="text-center type-small text-muted-foreground">
              {t('momenti.aura.chip', locale)}
            </Text>
          </View>
          <View className="gap-2 self-stretch">
            <Button
              variant="celebration"
              label={accepted ? fill('match.accepted.writeCta') : t('match.openCta', locale)}
              onPress={() => {
                if (conversationId) router.replace(`/chat?conversationId=${conversationId}`);
                else dismiss();
              }}
            />
            <Button
              variant="outline"
              label={accepted ? t('match.accepted.keepCta', locale) : t('match.laterCta', locale)}
              onPress={dismiss}
            />
          </View>
        </ScrollView>
      </Screen>
    </Animated.View>
  );
}
