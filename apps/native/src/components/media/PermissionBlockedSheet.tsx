import { Linking, Modal } from 'react-native';
import { t } from '@athanor/i18n';
import type { Locale } from '@athanor/schemas';
import { Pressable, Text, View } from '@/tw';
import { Button } from '@/components/Button';
import { MODAL_A11Y } from '@/lib/a11y';

/**
 * What the member sees AFTER the OS has refused and can no longer ask: the permission is off in
 * Settings, and this sheet says so and deep-links there.
 *
 * It is never shown BEFORE an OS prompt (#908, Marco's ruling 2026-10-01). Until then this file
 * was `PermissionPrimer`, a sheet that sat in front of the dialog with «Consenti» and «Non ora»;
 * App Review rejected exactly that pair under Guideline 5.1.1(iv) (submission `4cb70b1c`,
 * 2026-10-01): a custom message may not carry an "Allow" button, and may not offer a way to close
 * it without reaching the system request. So the tap on a feature now fires the OS prompt
 * directly, and nothing of ours stands before it. `source-audit.test.ts` pins that.
 *
 * Bottom-anchored transparent Modal (no Sheet primitive in the app). Fade-only animation →
 * reduced-motion safe (no transform). The same sheet as `MediaSheet` (#921, Marco 2026-10-06): a
 * charcoal `surface` panel with a 28 top radius on a 70% black scrim, no grab handle. The CTA is
 * the `primary` pill, since opening Settings is an ordinary action, and «Chiudi» is the text link.
 */
export function PermissionBlockedSheet({
  kind,
  visible,
  locale,
  onDismiss,
  onDismissed,
}: {
  kind: 'camera' | 'microphone';
  visible: boolean;
  locale: Locale;
  /** The member asked to close it («Chiudi», the scrim, Android back). Not RN's `onDismiss`. */
  onDismiss: () => void;
  /**
   * iOS only: the sheet is fully off screen — RN Modal's `onDismiss`, renamed because the prop
   * above already took the name. A sheet nested in another Modal (`MediaSheet`) must be gone
   * before its parent hides or presents anything else (#859, `nested-modal-gate.ts`).
   */
  onDismissed?: () => void;
}) {
  // Literal keys on both arms — a key spelled by a template literal is invisible to the i18n
  // checker and to a grep for orphans.
  const titleKey =
    kind === 'camera' ? 'permission.blocked.camera' : 'permission.blocked.microphone';

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onDismiss}
      {...(onDismissed ? { onDismiss: onDismissed } : {})}
    >
      {/*
       * scrim — tap outside to dismiss (`background` at 70%, DESIGN §6's scrim).
       *
       * `accessible={false}` on both this and the sheet below (#518 follow-up). `Pressable`
       * defaults `accessible={true}`, and on iOS an accessible view is ATOMIC: VoiceOver
       * focuses it as one unit and never descends. Two accessible ancestors therefore made
       * every control in this sheet unreachable — «Apri Impostazioni» and «Chiudi» alike. The
       * flag only stops a view being an accessibility ELEMENT; it does not touch touch
       * handling, so tap-outside-to-dismiss below and the stop-propagation no-op still work.
       *
       * The scrim is decoration carrying a gesture and the sheet is a container. Neither is a
       * control, so neither should be focusable — and while either was, nothing under it was.
       */}
      <Pressable accessible={false} className="flex-1 justify-end" onPress={onDismiss}>
        {/* The dim: a layer of its own, because an opacity on the scrim would dim the panel
            too, and `bg-background/70` draws nothing here (iPhone SE simulator, Expo Go,
            2026-10-06: the screen behind kept its pixels). */}
        <View pointerEvents="none" className="absolute inset-0 bg-background opacity-70" />
        {/* sheet — stop propagation so taps inside don't dismiss */}
        <Pressable
          {...MODAL_A11Y}
          accessible={false}
          className="rounded-t-[28px] bg-surface px-5 pb-12 pt-7"
          onPress={() => {}}
        >
          <View className="items-center">
            <Text accessibilityRole="header" className="type-h2 text-center text-foreground">
              {t(titleKey, locale)}
            </Text>
            <Text className="type-small mt-2 text-center text-muted-foreground">
              {t('permission.blocked.body', locale)}
            </Text>
          </View>

          <View className="mt-8 gap-3">
            <Button
              label={t('permission.openSettings', locale)}
              variant="primary"
              onPress={() => {
                void Linking.openSettings();
              }}
            />
            <Button variant="ghost" label={t('common.close', locale)} onPress={onDismiss} />
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
