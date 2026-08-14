import { t } from '@athanor/i18n';
import type { Locale } from '@athanor/schemas';
import { View } from '@/tw';
import { Chip } from '@/components/Chip';

/**
 * The IT/EN locale toggle — one control shared by settings, profile edit and
 * onboarding step 0 (#158), so the surfaces can never drift in shape. Language
 * names render in their own language (`lang.it` / `lang.en`), readable whichever
 * copy is currently wrong for the reader. Persistence is the caller's job: the
 * three hosts write to different places (profiles.locale directly, the edit
 * form's save, the onboarding draft) that all end at `profiles.locale`.
 */
export function LocaleChips({
  value,
  onChange,
  small = false,
}: {
  value: Locale;
  onChange: (next: Locale) => void;
  small?: boolean;
}) {
  return (
    <View
      className={small ? 'flex-row gap-2' : 'flex-row gap-3'}
      accessibilityRole="radiogroup"
      accessibilityLabel={t('settings.lang.title', value)}
    >
      <Chip
        small={small}
        label={t('lang.it', value)}
        selected={value === 'it'}
        onPress={() => onChange('it')}
      />
      <Chip
        small={small}
        label={t('lang.en', value)}
        selected={value === 'en'}
        onPress={() => onChange('en')}
      />
    </View>
  );
}
