import { t } from '@athanor/i18n';
import { Text, View } from '@/tw';
import { Mandorla } from '@/components/Mandorla';
import { Button } from '@/components/Button';
import { deviceLocale } from '@/lib/locale';
import { useAnnounceOnMount, MODAL_A11Y } from '@/lib/a11y';

/**
 * Blocking maintenance screen (frontend 12 §10.2). «Riprova» re-checks the flag (refetch). Distinct
 * from offline (§5) — this is us, not the network. Optional ETA when the backend supplies one.
 */
export function MaintenanceScreen({ eta, onRetry }: { eta?: string | null; onRetry: () => void }) {
  useAnnounceOnMount(t('maintenance.title', deviceLocale));

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
        {t('maintenance.title', deviceLocale)}
      </Text>
      <Text className="mt-3 text-center text-base text-muted-foreground">
        {t('maintenance.body', deviceLocale)}
      </Text>
      {eta ? (
        <Text className="mt-2 text-center text-sm text-muted-foreground">
          {t('maintenance.eta', deviceLocale, { time: eta })}
        </Text>
      ) : null}
      <View className="mt-8 w-full">
        <Button label={t('maintenance.retry', deviceLocale)} variant="primary" onPress={onRetry} />
      </View>
    </View>
  );
}
