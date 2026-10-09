import { t, type Locale } from '@athanor/i18n';
import { Text, View } from '@/tw';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { SectionLabel } from '@/components/SectionLabel';

/**
 * «Il varco è in viaggio» — the state after a recovery mail is requested. Shared by
 * (auth)/forgot-password (the first request) and auth-callback (the one-tap resend after a
 * dead link, #863), so the member reads the same card, with the same two warnings, however
 * they got there.
 *
 * Confirmation register, not moment register — the same rule-4 call the signup confirmation
 * makes: nothing has happened yet, a mail is in flight. A ✓ in foreground and words, no ✦: the
 * mobile look has no green (DESIGN §2.3).
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
    <View className="mt-[26px] gap-[26px]">
      <View className="gap-2">
        <SectionLabel>{t('auth.forgot.sent.eyebrow', locale)}</SectionLabel>
        <Text accessibilityRole="header" className="type-h1 text-foreground">
          {t('auth.forgot.sent.title', locale)}
        </Text>
      </View>

      <Card>
        {/* The ✓ leads its sentence; the reader gets the sentence without the mark. */}
        <Text
          className="type-body text-foreground"
          accessibilityLabel={t('auth.forgot.sent.body', locale, { email })}
        >
          ✓ {t('auth.forgot.sent.body', locale, { email })}
        </Text>
        {/* The one failure copy can prevent: a link opened on another device
          has no code-verifier to meet it (PKCE) and dies as «varco scaduto». */}
        <Text className="type-small text-muted-foreground">
          {t('auth.forgot.sent.hint', locale)}
        </Text>
        {/* #863: GoTrue's flow state lives 300 s from the request, and mail can take longer
          than that. Copy cannot speed the mail up; it can say the clock is running, and that
          a second request retires the first (its code-verifier is overwritten on this device). */}
        <Text className="type-small text-muted-foreground">
          {t('auth.forgot.sent.timing', locale)}
        </Text>
      </Card>

      <Button
        variant="ghost"
        label={t('auth.forgot.sent.changeEmail', locale)}
        onPress={onChangeEmail}
      />
    </View>
  );
}
