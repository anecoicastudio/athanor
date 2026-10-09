import { Modal } from 'react-native';
import { t } from '@athanor/i18n';
import type { Locale } from '@athanor/schemas';
import { Pressable, ScrollView, Text, View } from '@/tw';
import { MODAL_A11Y } from '@/lib/a11y';
import { Row } from '@/components/Row';
import { RowGroup } from '@/components/RowGroup';

/**
 * The per-message action sheet (#574) — today one action: report THIS message.
 *
 * Not `Alert.alert`, and that is the point rather than a preference. The chat overflow menu's
 * report arm is Alert-gated, and `Alert` is a silent no-op on react-native-web — which is the
 * only harness this app can be walked on here (no simulator on this machine). An affordance
 * built on it would be untestable by construction and dead on the web build. This is the
 * `MediaSheet` / `AudioRecorderSheet` idiom instead: a transparent bottom Modal, a scrim that
 * closes on tap, and rows that are ordinary Pressables. Since 2026-10-09 (#921) it is
 * `MediaSheet`'s panel too: charcoal `surface`, radius 28 at the top, no grab handle and no
 * border, over a 70% dim drawn as a layer of its own, the actions the shared `Row` in one
 * `RowGroup`. The panel scrolls when it is taller than the screen, as that one does.
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
      <Pressable accessible={false} className="flex-1 justify-end" onPress={onClose}>
        <View pointerEvents="none" className="absolute inset-0 bg-background opacity-70" />
        <Pressable
          {...MODAL_A11Y}
          accessible={false}
          className="max-h-[88%] rounded-t-[28px] bg-surface px-1 pb-12 pt-7"
          onPress={() => {}}
        >
          <ScrollView alwaysBounceVertical={false}>
            <Text accessibilityRole="header" className="type-h2 px-4 text-center text-foreground">
              {t('chat.message.actions', locale)}
            </Text>
            {/* The group's own 16 and the panel's 4 put the rows on the 20 gutter. */}
            <View className="mt-4">
              <RowGroup>
                <Row
                  title={t('chat.message.report', locale)}
                  showChevron={false}
                  onPress={onReport}
                />
                <Row title={t('common.cancel', locale)} showChevron={false} onPress={onClose} />
              </RowGroup>
            </View>
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
