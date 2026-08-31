import { Modal } from 'react-native';
import { t } from '@athanor/i18n';
import type { Locale } from '@athanor/schemas';
import { Pressable, Text, View } from '@/tw';
import { MODAL_A11Y } from '@/lib/a11y';

/**
 * The per-message action sheet (#574) — today one action: report THIS message.
 *
 * Not `Alert.alert`, and that is the point rather than a preference. The chat overflow menu's
 * report arm is Alert-gated, and `Alert` is a silent no-op on react-native-web — which is the
 * only harness this app can be walked on here (no simulator on this machine). An affordance
 * built on it would be untestable by construction and dead on the web build. This is the
 * `MediaSheet` / `AudioRecorderSheet` idiom instead: a transparent bottom Modal, a scrim that
 * closes on tap, and rows that are ordinary Pressables.
 *
 * `accessible={false}` on the scrim and the sheet body, copied from `MediaSheet` for the same
 * reason (#518): `Pressable` defaults to being an accessibility ELEMENT, and on iOS an
 * accessible view is atomic — VoiceOver focuses it as one unit and never descends — which
 * would make every row below unreachable. The flag removes them as elements without touching
 * touch handling, so tap-outside-to-close still works.
 *
 * The explicit cancel row is not decoration either: once the scrim stops being an
 * accessibility element, tapping outside is unreachable by a screen reader, and this sheet
 * would otherwise offer a way in and none out.
 */
export function MessageActionsSheet({
  visible,
  locale,
  onReport,
  onClose,
  onDismissed,
}: {
  visible: boolean;
  locale: Locale;
  onReport: () => void;
  onClose: () => void;
  /**
   * iOS-only, fired once the Modal is fully gone. Callers that NAVIGATE out of a row use it to
   * defer the push: a native screen presented while this Modal is still dismissing hits the
   * same "silently fails to present" edge `MediaSheet` documents for the image picker, and the
   * fix there is the same — close first, act from here. Requires the caller to keep this
   * component mounted (`visible={false}`, never a conditional render), or the queued action
   * dies with the unmount.
   */
  onDismissed?: () => void;
}) {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      {...(onDismissed ? { onDismiss: onDismissed } : {})}
    >
      <Pressable
        accessible={false}
        className="flex-1 justify-end bg-surface-muted"
        onPress={onClose}
      >
        <Pressable
          {...MODAL_A11Y}
          accessible={false}
          className="rounded-t-card border-t border-hair bg-raise px-6 pb-12 pt-7"
          onPress={() => {}}
        >
          <Text
            accessibilityRole="header"
            className="text-center text-lg font-semibold text-foreground"
          >
            {t('chat.message.actions', locale)}
          </Text>
          <View className="mt-6 gap-2">
            <Row label={t('chat.message.report', locale)} onPress={onReport} />
            <View className="mt-1 border-t border-hair pt-1">
              <Row label={t('common.cancel', locale)} onPress={onClose} />
            </View>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

/** One row in the sheet — same measurements as `MediaSheet`'s, so the two read as one idiom. */
function Row({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable
      className="h-[52px] flex-row items-center rounded-ctl px-4"
      accessibilityRole="button"
      onPress={onPress}
    >
      <Text className="text-[16px] text-foreground">{label}</Text>
    </Pressable>
  );
}
