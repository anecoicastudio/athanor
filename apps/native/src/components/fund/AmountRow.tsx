import { useState } from 'react';
import { MIN_CONTRIBUTION_CENTS, parseEuroToCents } from '@athanor/core';
import { t } from '@athanor/i18n';
import { semantic } from '@athanor/config';
import { Pressable, Text, TextInput, View } from '@/tw';

// The smallest chip IS the floor — a preset the parser would reject is a chip that cannot be
// paid. Derived so raising the minimum can never strand it below the line (#387).
const PRESETS_CENTS = [MIN_CONTRIBUTION_CENTS, 500, 1000, 2500] as const;

// The two strings that QUOTE the floor take it as a variable: copy that states a number is a
// declaration of that number, and «Il minimo è 1€» would go on reassuring the payer after the
// floor moved. The catalogs still own the words and the per-locale € placement (#387).
const MIN_EURO = String(MIN_CONTRIBUTION_CENTS / 100);

export function AmountRow({
  amountCents,
  onChange,
  locale,
}: {
  amountCents: number;
  onChange: (cents: number | null) => void;
  locale: 'it' | 'en';
}) {
  const [custom, setCustom] = useState(false);
  const [draft, setDraft] = useState('');
  const [err, setErr] = useState(false);

  const selectPreset = (cents: number) => {
    setCustom(false);
    setErr(false);
    setDraft('');
    onChange(cents);
  };

  const onDraft = (text: string) => {
    setDraft(text);
    const cents = parseEuroToCents(text);
    setErr(text.length > 0 && cents === null);
    onChange(cents); // null until valid → CTA disables
  };

  const chip = (label: string, active: boolean, onPress: () => void, key: string) => (
    <Pressable
      key={key}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      className={`min-h-[44px] justify-center rounded-ctl border px-4 py-2 ${
        active ? 'border-aura-line bg-aura-soft' : 'border-hair bg-raise'
      }`}
    >
      <Text className={`text-[14px] ${active ? 'text-aura' : 'text-foreground'}`}>{label}</Text>
    </Pressable>
  );

  return (
    <View className="gap-2">
      <View className="flex-row flex-wrap gap-2">
        {PRESETS_CENTS.map((c) =>
          chip(`${c / 100}€`, !custom && amountCents === c, () => selectPreset(c), `p${c}`),
        )}
        {chip(
          t('fund.amount.custom', locale),
          custom,
          () => {
            setCustom(true);
            onChange(parseEuroToCents(draft));
          },
          'custom',
        )}
      </View>
      {custom ? (
        <View className="gap-1">
          <TextInput
            value={draft}
            onChangeText={onDraft}
            keyboardType="decimal-pad"
            placeholder={t('fund.amount.customPlaceholder', locale, { min: MIN_EURO })}
            placeholderTextColor={semantic.foregroundMuted}
            className="rounded-ctl border border-hair bg-raise px-4 py-3 text-[15px] text-foreground"
            accessibilityLabel={t('fund.amount.custom', locale)}
          />
          {err ? (
            <Text className="text-[12px] text-error">
              {t('fund.amount.error', locale, { min: MIN_EURO })}
            </Text>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}
