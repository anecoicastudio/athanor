import { t } from '@athanor/i18n';
import { Text, View } from '@/tw';
import { Mandorla } from '@/components/Mandorla';
import { Button } from '@/components/Button';
import { deviceLocale } from '@/lib/locale';
import { useAnnounceOnMount, MODAL_A11Y } from '@/lib/a11y';

/**
 * The fallback behind the root error boundary (#452): what a render fatal shows instead of a
 * white screen. Sibling of ProfileErrorScreen and MaintenanceScreen, and deliberately the same
 * shape — mandorla, one headline, one line, one way out — because a member who lands here is
 * already having the worst moment the app can give them.
 *
 * Rendered as a COMPONENT by `@sentry/react`'s ErrorBoundary, not called as a render prop
 * (`errorboundary.js` does `React.createElement(fallback, {...})`), so it takes the boundary's
 * props directly and must be a stable reference at the call site — an inline arrow would be a
 * new component type on every render and would remount this screen underneath the user.
 *
 * It carries no provider of its own on purpose: the tree it replaced is gone, so it may only use
 * what works standalone — `t` is a plain function, the `@/tw` wrappers need no context, and the
 * layout takes no safe-area insets.
 *
 * The error text is shown in dev only. It is the first thing a developer wants and the last thing
 * a member needs, and an exception message can carry whatever was being rendered when it threw
 * (RUNBOOK §3.5.1) — a screenshot of this screen should never be the leak.
 */
export function AppErrorScreen({ error, resetError }: { error: unknown; resetError: () => void }) {
  useAnnounceOnMount(t('crash.title', deviceLocale));

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
        {t('crash.title', deviceLocale)}
      </Text>
      <Text className="mt-3 text-center text-base text-muted-foreground">
        {t('crash.body', deviceLocale)}
      </Text>
      {__DEV__ && error instanceof Error ? (
        // Not routed through @athanor/i18n, and not exempted either: the checker reads literals,
        // and this is the exception's own text. Dev-only, never shown to a member.
        <Text className="mt-4 text-center text-[13px] text-muted-foreground">{error.message}</Text>
      ) : null}
      <View className="mt-8 w-full gap-3">
        <Button label={t('crash.retry', deviceLocale)} variant="primary" onPress={resetError} />
      </View>
    </View>
  );
}
