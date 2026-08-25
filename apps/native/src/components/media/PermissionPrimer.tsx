import { Linking, Modal } from 'react-native';
import { t } from '@athanor/i18n';
import type { Locale } from '@athanor/schemas';
import { Pressable, Text, View } from '@/tw';
import { Button } from '@/components/Button';
import type { PermStatus } from '@/lib/media/permissions';
import { MODAL_A11Y } from '@/lib/a11y';

/**
 * Pre-permission priming sheet (resilience §7 / privacy-by-design). Shown BEFORE
 * the OS dialog so the user understands why we ask — a denied OS prompt is
 * expensive to recover from. When the permission is already `blocked` we swap the
 * copy + CTA to deep-link into Settings instead of firing a prompt that won't show.
 *
 * Bottom-anchored transparent Modal (no Sheet primitive in the app — mirrors
 * Lightbox). Fade-only animation → reduced-motion safe (no transform). The CTAs
 * are flat cyan (`variant="light"`, no glow): granting a permission is not a
 * moment event, so rule #4 keeps the glow off.
 */
export function PermissionPrimer({
  kind,
  status,
  visible,
  locale,
  onAllow,
  onDismiss,
}: {
  kind: 'camera' | 'photos';
  status: PermStatus;
  visible: boolean;
  locale: Locale;
  onAllow: () => void;
  onDismiss: () => void;
}) {
  const blocked = status === 'blocked';
  const titleKey = kind === 'camera' ? 'permission.camera.title' : 'permission.photos.title';
  const bodyKey = kind === 'camera' ? 'permission.camera.body' : 'permission.photos.body';

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onDismiss}>
      {/*
       * scrim — tap outside to dismiss (surface-muted is the token's documented scrim).
       *
       * `accessible={false}` on both this and the sheet below (#518 follow-up). `Pressable`
       * defaults `accessible={true}`, and on iOS an accessible view is ATOMIC: VoiceOver
       * focuses it as one unit and never descends. Two accessible ancestors therefore made
       * every control in this primer unreachable — «Consenti», «Apri Impostazioni» and «Non
       * ora» alike, not just one of them. The flag only stops a view being an accessibility
       * ELEMENT; it does not touch touch handling, so tap-outside-to-dismiss below and the
       * stop-propagation no-op still work exactly as before.
       *
       * The scrim is decoration carrying a gesture and the sheet is a container. Neither is a
       * control, so neither should be focusable — and while either was, nothing under it was.
       */}
      <Pressable
        accessible={false}
        className="flex-1 justify-end bg-surface-muted"
        onPress={onDismiss}
      >
        {/* sheet — stop propagation so taps inside don't dismiss */}
        <Pressable
          {...MODAL_A11Y}
          accessible={false}
          className="rounded-t-card border-t border-hair bg-raise px-6 pb-12 pt-8"
          onPress={() => {}}
        >
          <View className="items-center">
            <Text
              className="text-4xl text-aura"
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
            >
              ✦
            </Text>
            <Text
              accessibilityRole="header"
              className="mt-5 text-center text-xl font-semibold text-foreground"
            >
              {t(titleKey, locale)}
            </Text>
            <Text className="mt-2 text-center text-[15px] leading-5 text-faint">
              {t(blocked ? 'permission.blocked.body' : bodyKey, locale)}
            </Text>
          </View>

          <View className="mt-8 gap-3">
            {blocked ? (
              <Button
                label={t('permission.openSettings', locale)}
                variant="light"
                onPress={() => {
                  void Linking.openSettings();
                }}
              />
            ) : (
              <Button label={t('permission.allow', locale)} variant="light" onPress={onAllow} />
            )}
            <Pressable
              className="h-[52px] items-center justify-center"
              accessibilityRole="button"
              onPress={onDismiss}
            >
              <Text className="tracking-widest text-faint">{t('permission.notNow', locale)}</Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
