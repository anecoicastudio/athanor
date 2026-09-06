import { useRouter } from 'expo-router';
import { useState } from 'react';
import { t } from '@athanor/i18n';
import { PASSWORD_REQUIREMENTS, passwordSchema, unmetPasswordRequirements } from '@athanor/schemas';
import { ScrollView, Text, View } from '@/tw';
import { Button } from '@/components/Button';
import { EyeGlyph, EyeOffGlyph } from '@/components/glyphs';
import { Input } from '@/components/Input';
import { KeyboardAvoiding } from '@/components/KeyboardAvoiding';
import { Screen } from '@/components/Screen';
import { SectionLabel } from '@/components/SectionLabel';
import { useToast } from '@/components/ToastHost';
import { useLocale } from '@/hooks/use-locale';
import { useRevealOnFocus } from '@/hooks/use-reveal-on-focus';
import { useAuth } from '@/lib/auth-context';
import { useAnnounceOnMount } from '@/lib/a11y';
import { supabase } from '@/lib/supabase';

/**
 * Password recovery, choose half (#631). Reached only through AuthGuard's
 * recoveryPending branch (_layout.tsx): the exchanged recovery link left a live
 * session, and the guard parks it here until the latch clears. Dismissing the
 * sheet just re-presents it — so the way OUT is explicit: save, or skip.
 *
 * Skip is legitimate, not a trap: the recovery session is a full session and the
 * old password still works. «Più tardi» clears the latch and lets the guard
 * route home. A member who only remembered their password after asking for the
 * link loses nothing.
 *
 * updateUser needs no old password — the recovery exchange already proved
 * mailbox control. No confirm-password field: the reveal eye is the mistype
 * guard this design system uses (welcome.tsx precedent), and a wrong password
 * saved here has this same flow as its remedy.
 */
export default function NewPasswordScreen() {
  const [password, setPassword] = useState('');
  const [revealed, setRevealed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { clearRecovery } = useAuth();
  const { showToast } = useToast();
  const router = useRouter();
  const locale = useLocale();
  // Same assist as (auth)/welcome (#689): the wrapper uncovers the viewport, this puts the
  // field and its checklist inside it. Measuring against the list's own content view, so the
  // sheet this screen is presented in never enters the arithmetic.
  const reveal = useRevealOnFocus();

  const unmet = unmetPasswordRequirements(password);
  const disabled = saving || password.length === 0 || unmet.length > 0;

  useAnnounceOnMount(t('auth.newPassword.display', locale));

  const leave = () => {
    // The guard stops redirecting the moment the latch clears; replace, don't
    // dismiss — the sheet was force-presented, so there may be no stack under it.
    clearRecovery();
    router.replace('/(tabs)');
  };

  const submit = async () => {
    // Boundary re-parse, same reason as welcome.tsx: a password manager can fill
    // and submit in one frame past the disabled hint.
    if (!passwordSchema.safeParse(password).success) {
      setError(t('auth.error.weakPassword', locale));
      return;
    }
    setSaving(true);
    setError(null);
    const { error: err } = await supabase.auth.updateUser({ password });
    if (err) {
      if (__DEV__) console.warn('[auth] updateUser', err.status, err.code, err.message);
      setSaving(false);
      setError(
        t(err.code === 'same_password' ? 'auth.error.samePassword' : 'auth.error.generic', locale),
      );
      return;
    }
    // Confirmation register (rule 4): a saved password is a confirmation, not a
    // moment — default tone, no ✦.
    showToast(t('auth.newPassword.done', locale));
    leave();
  };

  return (
    <KeyboardAvoiding>
      <Screen>
        <ScrollView
          {...reveal.scrollProps}
          className="flex-1"
          contentContainerClassName="grow px-5 pb-9 pt-4"
          keyboardShouldPersistTaps="handled"
        >
          <View className="mt-6 gap-3">
            <SectionLabel tone="aura">{t('auth.newPassword.eyebrow', locale)}</SectionLabel>
            <Text className="text-[28px] font-bold tracking-[-0.02em] text-foreground">
              {t('auth.newPassword.display', locale)}
            </Text>
            <Text className="text-[15px] leading-[22px] text-muted-foreground">
              {t('auth.newPassword.sub', locale)}
            </Text>
          </View>

          <View className="mt-8 gap-2" ref={reveal.rowRef('password')}>
            <Text className="text-xs font-medium text-muted-foreground">
              {t('auth.password.label', locale)}
            </Text>
            <Input
              {...reveal.fieldProps('password')}
              autoCapitalize="none"
              autoComplete="new-password"
              // iOS AutoFill: `none`, not `newPassword` — the strong-password overlay
              // replaces the whole value on re-focus (#615's hypothesis 2; welcome.tsx
              // makes the same call on EVERY field of its signup branch, for the same
              // reason — widened from the password alone by #662).
              textContentType="none"
              secureTextEntry={!revealed}
              placeholder={t('auth.password.placeholder', locale)}
              value={password}
              onChangeText={setPassword}
              trailing={{
                icon: revealed ? <EyeOffGlyph size={20} /> : <EyeGlyph size={20} />,
                onPress: () => setRevealed((shown) => !shown),
                accessibilityLabel: t(
                  revealed ? 'a11y.password.hide' : 'a11y.password.show',
                  locale,
                ),
              }}
            />
            {/* The welcome.tsx checklist, verbatim recipe: rule stated before typing,
              live afterwards; `success` not `aura` (a satisfied rule is a confirmation);
              met/unmet carried by mark + SR label, never colour alone (G2). */}
            {password.length === 0 ? (
              <Text className="px-5 text-xs text-muted-foreground">
                {t('auth.password.hint', locale)}
              </Text>
            ) : (
              <View className="gap-1 px-5">
                {PASSWORD_REQUIREMENTS.map((requirement) => {
                  const met = !unmet.includes(requirement);
                  const label = t(`auth.password.req.${requirement}`, locale);
                  return (
                    <Text
                      key={requirement}
                      className={`text-xs ${met ? 'text-success' : 'text-muted-foreground'}`}
                      accessibilityLabel={`${t(met ? 'a11y.req.met' : 'a11y.req.unmet', locale)} ${label}`}
                    >
                      {met ? '✓' : '•'} {label}
                    </Text>
                  );
                })}
              </View>
            )}
          </View>

          {error ? <Text className="mt-3 text-sm text-error">{error}</Text> : null}

          <View className="mt-7 gap-3">
            <Button
              variant="light"
              label={t('auth.newPassword.cta', locale)}
              disabled={disabled}
              loading={saving}
              onPress={submit}
            />
            <Button variant="ghost" label={t('auth.newPassword.skip', locale)} onPress={leave} />
          </View>
        </ScrollView>
      </Screen>
    </KeyboardAvoiding>
  );
}
