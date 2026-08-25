import { useRef, useState } from 'react';
import { Modal, Platform } from 'react-native';
import { t, type MessageKey } from '@athanor/i18n';
import type { Locale } from '@athanor/schemas';
import { Pressable, Text, View } from '@/tw';
import { PermissionPrimer } from '@/components/media/PermissionPrimer';
import {
  ensureCameraPermission,
  ensureLibraryPermission,
  peekCameraPermission,
  peekLibraryPermission,
  type PermStatus,
} from '@/lib/media/permissions';
import {
  capturePhoto,
  pickFromLibrary,
  recordVideo,
  type MediaPickResult,
  type PickedMedia,
} from '@/lib/media/pick';
import { REJECTION_MESSAGE } from '@/lib/media/asset';
import { MODAL_A11Y } from '@/lib/a11y';

/** Which source a row launches once its permission is granted. */
type Source = 'photo' | 'video' | 'library';

/**
 * The `sheet-media` picker (frontend `01` §3.6 / backend 10). A bottom Modal with
 * three sources: take a photo, record a video (when `allowVideo`), or pick from
 * the library. Each source primes the relevant permission via {@link
 * PermissionPrimer} BEFORE the OS prompt (skipped when already granted), then
 * runs the matching `pick.ts` function and hands the descriptor up to `onPick`.
 *
 * State machine:
 *   idle → (tap row) → peek granted? → close sheet → launch picker → onPick
 *                    → else primer(source)
 *   priming → (allow) → OS prompt → granted → close sheet → launch → onPick
 *                                 → blocked → primer stays, swaps to Settings CTA
 *   priming → (dismiss) → idle
 *
 * iOS CRITICAL: the picker/camera view controller silently fails to present
 * while an RN Modal is still up (known Expo issue) — so on grant we CLOSE the
 * sheet first and launch only from the Modal's `onDismiss` (iOS-only callback).
 * Android/web present independently → launch right after `onClose()`. Callers
 * must keep this component mounted (visible={false}, not conditional render) or
 * the queued launch dies with the unmount.
 *
 * No glow anywhere (rule #4): attaching media isn't itself a moment.
 */
export function MediaSheet({
  visible,
  locale,
  onPick,
  onClose,
  onError,
  allowVideo = false,
}: {
  visible: boolean;
  locale: Locale;
  onPick: (m: PickedMedia) => void;
  onClose: () => void;
  /**
   * Something is worth saying and it is not a pick: the key to render (#507).
   *
   * Two sources. The picker THREW (camera unavailable, interrupted…) → `media.failed`, which is
   * all a thrown exception supports. Or the asset was REFUSED by a rule we wrote — today only
   * the 60s cap — and then the key names the rule: «Il video può durare al massimo 60 secondi.»
   * A refusal reported as `media.failed` would be a lie, and reported as nothing at all was the
   * bug: the sheet closed on an over-cap video without a word.
   */
  onError?: (key: MessageKey) => void;
  allowVideo?: boolean;
}) {
  // The source the user tapped + the primer's permission status. `null` source
  // means the primer is closed and the sheet rows are interactive.
  const [pending, setPending] = useState<{ source: Source; status: PermStatus } | null>(null);
  const [busy, setBusy] = useState(false);
  // Source queued to launch after the Modal finishes dismissing (iOS path).
  const queuedLaunch = useRef<Source | null>(null);
  // Synchronous re-entry lock: `busy` state is async and lets a double-tap
  // race two picker launches (the second rejects → spurious onError).
  const launchLock = useRef(false);

  const primerKind = pending?.source === 'library' ? 'photos' : 'camera';

  async function doLaunch(source: Source) {
    setBusy(true);
    try {
      const result = await pickForSource(source, allowVideo);
      // `canceled` is the one ending that stays silent — the member backed out and knows it.
      // It used to be indistinguishable from a refusal, which is how an over-cap video came to
      // close the sheet saying nothing (#507).
      if (result.outcome === 'picked') onPick(result.media);
      else if (result.outcome === 'rejected') onError?.(REJECTION_MESSAGE[result.reason]);
    } catch {
      onError?.('media.failed');
    } finally {
      setBusy(false);
      launchLock.current = false;
    }
  }

  // Close the sheet, then launch: iOS defers to Modal onDismiss; elsewhere the
  // picker presents fine immediately after requesting the close.
  function closeThenLaunch(source: Source) {
    launchLock.current = true;
    setPending(null);
    if (Platform.OS === 'ios') {
      queuedLaunch.current = source;
      onClose();
      return;
    }
    onClose();
    void doLaunch(source);
  }

  // Tap a row → peek (no OS prompt). Already granted → straight to the picker;
  // otherwise open the primer («Consenti» fires the real request via run()).
  async function openPrimer(source: Source) {
    if (busy || launchLock.current) return;
    const status =
      source === 'library' ? await peekLibraryPermission() : await peekCameraPermission();
    if (status === 'granted') {
      closeThenLaunch(source);
      return;
    }
    setPending({ source, status });
  }

  // Primer «Consenti»: request the permission (this may show the OS dialog), and
  // on grant launch the matching picker. On block, keep the primer up so it can
  // render the Settings deep-link; the user re-taps to retry after enabling.
  async function run() {
    if (!pending) return;
    const { source } = pending;
    const status =
      source === 'library' ? await ensureLibraryPermission() : await ensureCameraPermission();

    if (status !== 'granted') {
      setPending({ source, status }); // 'denied' closes via dismiss; 'blocked' shows Settings
      return;
    }

    closeThenLaunch(source);
  }

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      onShow={() => {
        // Re-shown sheet must never fire a stale launch: if onDismiss was ever
        // missed (iOS double-dismiss edge with the nested primer), reset here.
        queuedLaunch.current = null;
        launchLock.current = false;
      }}
      onDismiss={() => {
        // iOS-only: fires once the modal is fully gone — safe to present the picker.
        const source = queuedLaunch.current;
        if (source) {
          queuedLaunch.current = null;
          void doLaunch(source);
        }
      }}
    >
      {/*
       * `accessible={false}` on the scrim and the sheet (#518 follow-up). `Pressable` defaults
       * `accessible={true}`, and on iOS an accessible view is ATOMIC — VoiceOver focuses it as
       * one unit and never descends — so these two ancestors made every row below unreachable.
       * The flag stops a view being an accessibility ELEMENT and leaves touch handling alone,
       * so tap-outside-to-close and the stop-propagation no-op are unchanged.
       */}
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
            {t('media.sheet.title', locale)}
          </Text>
          <Text className="mt-1 text-center text-[14px] leading-5 text-faint">
            {t('media.sheet.sub', locale)}
          </Text>

          <View className="mt-6 gap-2">
            <Row
              label={t('media.sheet.photo', locale)}
              disabled={busy}
              onPress={() => void openPrimer('photo')}
            />
            {allowVideo ? (
              <Row
                label={t('media.sheet.video', locale)}
                disabled={busy}
                onPress={() => void openPrimer('video')}
              />
            ) : null}
            <Row
              label={t('media.sheet.library', locale)}
              disabled={busy}
              onPress={() => void openPrimer('library')}
            />
            {/*
             * The exit (#518 follow-up). Once the scrim above stops being an accessibility
             * element, tapping outside is no longer reachable by a screen reader — and this
             * sheet had no other close control, so without this row a VoiceOver user could
             * reach the three options and nothing that leaves. `onAccessibilityEscape` cannot
             * stand in for it: RN fires the escape gesture only "when accessible is true"
             * (ViewAccessibility.d.ts:300-303), which is precisely what is turned off above.
             *
             * NOT `disabled={busy}`, unlike the three options: cancelling has to stay reachable
             * *especially* while something is in flight, or the dead end returns for exactly as
             * long as the sheet is busy.
             */}
            <View className="mt-1 border-t border-hair pt-1">
              <Row label={t('common.cancel', locale)} disabled={false} onPress={onClose} />
            </View>
          </View>
        </Pressable>
      </Pressable>

      {pending ? (
        <PermissionPrimer
          kind={primerKind}
          status={pending.status}
          visible
          locale={locale}
          onAllow={() => void run()}
          onDismiss={() => setPending(null)}
        />
      ) : null}
    </Modal>
  );
}

/** A single source row in the sheet. */
function Row({
  label,
  disabled,
  onPress,
}: {
  label: string;
  disabled: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      className={`h-[52px] flex-row items-center rounded-ctl px-4 ${disabled ? 'opacity-40' : ''}`}
      disabled={disabled}
      accessibilityRole="button"
      onPress={onPress}
    >
      <Text className="text-[16px] text-foreground">{label}</Text>
    </Pressable>
  );
}

// --- helpers ---------------------------------------------------------------

function pickForSource(source: Source, allowVideo: boolean): Promise<MediaPickResult> {
  if (source === 'photo') return capturePhoto();
  if (source === 'video') return recordVideo();
  return pickFromLibrary({ allowVideo });
}
