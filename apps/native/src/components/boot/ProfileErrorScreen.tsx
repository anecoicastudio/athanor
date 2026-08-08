import { t } from '@athanor/i18n';
import { Text, View } from '@/tw';
import { Mandorla } from '@/components/Mandorla';
import { Button } from '@/components/Button';
import { deviceLocale } from '@/lib/locale';
import { useAnnounceOnMount, MODAL_A11Y } from '@/lib/a11y';

/**
 * Shown when the session is valid but the profile read failed (network down, the
 * `get_own_profile` RPC absent from the target project, RLS). Before this screen
 * the guard simply returned on a null profile, so the user stayed on the auth
 * screen after a successful sign-in with nothing to read and nothing to press.
 *
 * «Riprova» re-reads the profile; «Esci» is the way out when the read keeps
 * failing. Distinct from MaintenanceScreen — that one is a deliberate server
 * pause, this is an unexpected failure.
 */
export function ProfileErrorScreen({
  onRetry,
  onSignOut,
}: {
  onRetry: () => void;
  onSignOut: () => void;
}) {
  useAnnounceOnMount(t('auth.profileError.title', deviceLocale));

  return (
    <View
      className="flex-1 items-center justify-center bg-background px-8"
      accessibilityRole="alert"
      {...MODAL_A11Y}
    >
      <Mandorla size={120} glowLevel={0}>
        <View />
      </Mandorla>
      <Text
        className="mt-8 text-center text-2xl font-bold text-foreground"
        accessibilityRole="header"
      >
        {t('auth.profileError.title', deviceLocale)}
      </Text>
      <Text className="mt-3 text-center text-base text-muted-foreground">
        {t('auth.profileError.body', deviceLocale)}
      </Text>
      <View className="mt-8 w-full gap-3">
        <Button
          label={t('auth.profileError.retry', deviceLocale)}
          variant="primary"
          onPress={onRetry}
        />
        <Button label={t('auth.signOut', deviceLocale)} variant="ghost" onPress={onSignOut} />
      </View>
    </View>
  );
}
