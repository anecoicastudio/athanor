import { t, type Locale } from '@athanor/i18n';
import { Text, View } from '@/tw';
import { Button } from '@/components/Button';
import { SectionLabel } from '@/components/SectionLabel';

/**
 * «Il varco è in viaggio» — the state after a recovery mail is requested. Shared by
 * (auth)/forgot-password (the first request) and auth-callback (the one-tap resend after a
 * dead link, #863), so the member reads the same card, with the same two warnings, however
 * they got there.
 *
 * Confirmation register, not moment register — the same rule-4 call the signup confirmation
 * makes: nothing has happened yet, a mail is in flight. `success` mark, no ✦, no glow.
 */
export function RecoverySent({
  email,
  locale,
  onChangeEmail,
}: {
  email: string;
  locale: Locale;
  onChangeEmail: () => void;
}) {
  return (
    <View className="mt-6 gap-4">
      <SectionLabel tone="aura">{t('auth.forgot.sent.eyebrow', locale)}</SectionLabel>
      <Text
        accessibilityRole="header"
        className="text-[28px] font-bold tracking-[-0.02em] text-foreground"
      >
        {t('auth.forgot.sent.title', locale)}
      </Text>

      <View className="mt-2 gap-3 rounded-hero border border-hair bg-raise p-5">
        <Text
          className="text-2xl text-success"
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          ✓
        </Text>
        <Text className="text-[15px] leading-[22px] text-foreground">
          {t('auth.forgot.sent.body', locale, { email })}
        </Text>
        {/* The one failure copy can prevent: a link opened on another device
          has no code-verifier to meet it (PKCE) and dies as «varco scaduto». */}
        <Text className="text-[13px] text-muted-foreground">
          {t('auth.forgot.sent.hint', locale)}
        </Text>
        {/* #863: GoTrue's flow state lives 300 s from the request, and mail can take longer
          than that. Copy cannot speed the mail up; it can say the clock is running, and that
          a second request retires the first (its code-verifier is overwritten on this device). */}
        <Text className="text-[13px] text-muted-foreground">
          {t('auth.forgot.sent.timing', locale)}
        </Text>
      </View>

      <Button
        variant="ghost"
        label={t('auth.forgot.sent.changeEmail', locale)}
        onPress={onChangeEmail}
      />
    </View>
  );
}
