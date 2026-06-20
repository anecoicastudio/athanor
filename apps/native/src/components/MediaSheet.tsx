import { useState } from 'react';
import { Modal } from 'react-native';
import { t } from '@athanor/i18n';
import type { Locale } from '@athanor/schemas';
import { Pressable, Text, View } from '@/tw';
import { PermissionPrimer } from '@/components/PermissionPrimer';
import {
  ensureCameraPermission,
  ensureLibraryPermission,
  peekCameraPermission,
  peekLibraryPermission,
  type PermStatus,
} from '@/lib/media/permissions';
import { capturePhoto, pickFromLibrary, recordVideo, type PickedMedia } from '@/lib/media/pick';
import { MODAL_A11Y } from '@/lib/a11y';

/** Which source a row launches once its permission is granted. */
type Source = 'photo' | 'video' | 'library';

/**
 * The `sheet-media` picker (frontend `01` §3.6 / backend 10). A bottom Modal with
 * three sources: take a photo, record a video (when `allowVideo`), or pick from
 * the library. Each source primes the relevant permission via {@link
 * PermissionPrimer} BEFORE the OS prompt, then runs the matching `pick.ts`
 * function and hands the descriptor up to `onPick`.
 *
 * State machine (deliberately small):
 *   idle → (tap row) → priming(source)         ← primer visible
 *   priming → (allow) → OS prompt → granted? → launch picker → onPick + onClose
 *                                  → blocked  → primer stays, swaps to Settings CTA
 *   priming → (dismiss) → idle
 *
 * No glow anywhere (rule #4): attaching media isn't itself a moment.
 */
export function MediaSheet({
  visible,
  locale,
  onPick,
  onClose,
  allowVideo = false,
}: {
  visible: boolean;
  locale: Locale;
  onPick: (m: PickedMedia) => void;
  onClose: () => void;
  allowVideo?: boolean;
}) {
  // The source the user tapped + the primer's permission status. `null` source
  // means the primer is closed and the sheet rows are interactive.
  const [pending, setPending] = useState<{ source: Source; status: PermStatus } | null>(null);
  const [busy, setBusy] = useState(false);

  const primerKind = pending?.source === 'library' ? 'photos' : 'camera';

  // Tap a row → resolve which permission it needs and open the primer. We don't
  // fire the OS prompt yet; the primer's «Consenti» does (via onAllow → run).
  async function openPrimer(source: Source) {
    if (busy) return;
    // Peek (no OS prompt) so an already-`blocked` permission seeds the primer's
    // Settings CTA; «Consenti» → run() does the actual request.
    const status =
      source === 'library' ? await peekLibraryPermission() : await peekCameraPermission();
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

    setPending(null);
    setBusy(true);
    try {
      const picked = await pickForSource(source, allowVideo);
      if (picked) {
        onPick(picked);
        onClose();
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable className="flex-1 justify-end bg-surface-muted" onPress={onClose}>
        <Pressable
          {...MODAL_A11Y}
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

function pickForSource(source: Source, allowVideo: boolean): Promise<PickedMedia | null> {
  if (source === 'photo') return capturePhoto();
  if (source === 'video') return recordVideo();
  return pickFromLibrary({ allowVideo });
}
