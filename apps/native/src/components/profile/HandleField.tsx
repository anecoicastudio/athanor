import { normalizeHandleInput } from '@athanor/core';
import { t } from '@athanor/i18n';
import type { Locale } from '@athanor/schemas';
import { Text, View, cn } from '@/tw';
import { Input } from '@/components/Input';
import { handleStatusLine, type HandleStatus } from '@/lib/handle-status';

const TONE_CLASS = {
  error: 'text-error',
  success: 'text-success',
  muted: 'text-muted-foreground',
} as const;

/**
 * The @handle field (#782) — one component for the two places a handle is chosen: the onboarding
 * step after sign-up and the profile editor. Never prefilled from anything but the handle the
 * member already holds: an email-derived suggestion the person taps through is the same leak as
 * no choice at all.
 *
 * What is typed is normalised on the way in (one leading `@` dropped, lowercased — the column is
 * lowercase-only) and nothing else is repaired, so a space or a dot stays for the status line to
 * name. The rules line is always there; the status line under it says why a handle cannot be
 * taken (#769: a refused submit always says why on screen). `refusal` — what the claim itself came
 * back with — outranks the live status until the person types again.
 *
 * `lockedNote` is the rename cooldown: the field shows the current handle read-only and the note
 * says when it opens. The TextInput stays mounted in both states — flipping between an Input and
 * a Text would remount it (`Input`'s docblock).
 */
export function HandleField({
  value,
  onChangeText,
  status,
  locale,
  refusal = null,
  lockedNote = null,
  autoFocus,
  onSubmitEditing,
}: {
  value: string;
  onChangeText: (next: string) => void;
  status: HandleStatus;
  locale: Locale;
  refusal?: string | null;
  lockedNote?: string | null;
  autoFocus?: boolean;
  onSubmitEditing?: () => void;
}) {
  const line = refusal
    ? { text: refusal, tone: 'error' as const }
    : handleStatusLine(status, locale);
  return (
    <View className="gap-2">
      <Input
        value={value}
        onChangeText={(next) => onChangeText(normalizeHandleInput(next))}
        editable={lockedNote === null}
        placeholder={t('handle.placeholder', locale)}
        accessibilityLabel={t('handle.label', locale)}
        autoCapitalize="none"
        autoCorrect={false}
        spellCheck={false}
        // A handle is being CREATED, never recalled: `none` keeps iOS from committing a username
        // suggestion over what was typed (#615's vector), `off` keeps Android's managers out.
        // `source-audit.test.ts` §35 registers the pair.
        autoComplete="off"
        textContentType="none"
        maxLength={30}
        returnKeyType="done"
        autoFocus={autoFocus}
        onSubmitEditing={onSubmitEditing}
      />
      {lockedNote !== null ? (
        <Text className="text-[13px] leading-snug text-muted-foreground">{lockedNote}</Text>
      ) : (
        <>
          <Text className="text-[13px] leading-snug text-muted-foreground">
            {t('handle.rules', locale)}
          </Text>
          {line ? (
            <Text
              className={cn('text-[13px] leading-snug', TONE_CLASS[line.tone])}
              accessibilityLiveRegion="polite"
            >
              {line.text}
            </Text>
          ) : null}
        </>
      )}
    </View>
  );
}
