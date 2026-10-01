import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Modal, Platform } from 'react-native';
import { t, type MessageKey } from '@athanor/i18n';
import type { Locale } from '@athanor/schemas';
import { Pressable, Text, View } from '@/tw';
import { AudioRecorderSheet } from '@/components/media/AudioRecorderSheet';
import { PermissionBlockedSheet } from '@/components/media/PermissionBlockedSheet';
import {
  ensureCameraPermission,
  ensureMicrophonePermission,
  peekCameraPermission,
  peekMicrophonePermission,
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
import { createNestedModalGate } from '@/lib/media/nested-modal-gate';
import { MODAL_A11Y } from '@/lib/a11y';

/** Which source a row launches once its permission is granted. */
type Source = 'photo' | 'video' | 'library' | 'audio';
/** The sources that hold a permission at all — the library does not (see {@link MediaSheet}). */
type GatedSource = Exclude<Source, 'library'>;

/**
 * The `sheet-media` picker (frontend `01` §3.6 / backend 10). A bottom Modal with
 * up to four sources: take a photo, record a video (when `allowVideo`), record audio (when
 * `allowAudio`), or pick from the library. A row tap asks the OS for the permission DIRECTLY —
 * nothing of ours stands in front of the system dialog (#908, Marco's ruling 2026-10-01, after App
 * Review's Guideline 5.1.1(iv) rejection of the «Consenti» / «Non ora» primer) — then runs the
 * matching `pick.ts` function and hands the descriptor up to `onPick`. Only a permission the OS
 * can no longer ask for gets a sheet of ours, {@link PermissionBlockedSheet}, with the Settings
 * deep-link.
 *
 * **The library row asks for nothing.** `launchImageLibraryAsync` needs no photo permission on
 * any OS this app runs on (expo-image-picker 57.0.20's typings, read 2026-10-01: «Requires
 * `Permissions.MEDIA_LIBRARY` on iOS 10 only»): the system picker runs out of process and hands
 * back only what was picked. Asking anyway put a dialog — and before #908 a primer — in front of
 * a feature that works without either. `use-candidacy-upload.ts` has launched this way throughout.
 *
 * **`audio` is the one source that is not a picker** (#154). `expo-image-picker` has no audio
 * media type, so there is nothing to launch: the row opens {@link AudioRecorderSheet} as a
 * nested Modal instead, and that component calls `onPick` itself. Which is also why it skips
 * the iOS close-then-launch dance below — that exists for native view controllers, and the
 * recorder is our own React tree.
 *
 * State machine:
 *   idle → (tap library) → close sheet → launch picker → onPick
 *   idle → (tap row) → OS prompt, if the OS can still ask
 *                    → granted → close sheet → launch picker → onPick
 *                    → denied (Android, one explicit «Don't allow») → idle; the next tap asks again
 *                    → blocked → blocked sheet (Settings)
 *   blocked → (dismiss, or back from Settings with the permission on) → idle
 *
 * iOS CRITICAL: the picker/camera view controller silently fails to present
 * while an RN Modal is still up (known Expo issue) — so on grant we CLOSE the
 * sheet first and launch only from the Modal's `onDismiss` (iOS-only callback).
 * Android/web present independently → launch right after `onClose()`. Callers
 * must keep this component mounted (visible={false}, not conditional render) or
 * the queued launch dies with the unmount.
 *
 * iOS CRITICAL, second half (#859): the blocked sheet and the recorder are Modals nested in this one,
 * i.e. controllers presented BY this sheet's. Hiding the sheet in the same batch that closes
 * one of them sends the sheet's dismissal to the child instead: the sheet stays presented, RN
 * still reports its `onDismiss`, its content unmounts, and an empty full-screen controller is
 * left taking every touch — the app looks alive and answers nothing until it is killed. So a
 * child closes first (kept mounted with `visible={false}`), and whatever comes next — hiding
 * this sheet, opening the recorder — runs from the child's own `onDismiss`, through
 * `nested-modal-gate.ts`. While a child is on its way out the rows ignore taps: presenting from
 * a controller mid-dismissal fails silently too. A grant no longer passes through a nested child
 * (the OS dialog is not a Modal of ours), so only a DISMISSED blocked sheet and the recorder go
 * through the gate now.
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
  allowAudio = false,
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
  /**
   * Offer the voice recorder (#154).
   *
   * Gated, and never defaulted on, because `post-media` is the ONLY bucket whose
   * `allowed_mime_types` lists an audio type: `moments` and `story-segments` accept images and
   * video and nothing else (20260819163146), and `moment_kind` / `story_kind` are both
   * `('photo','video')` enums. An unconditional row would offer a recording to the avatar,
   * moments and story composers, where it would be refused by the bucket after uploading —
   * or, worse, written to a table whose enum has no value for it.
   */
  allowAudio?: boolean;
}) {
  // The source whose permission the OS will not ask for again. `null` means the blocked sheet
  // is closed and the rows are interactive.
  // It outlives the sheet being SHOWN: on iOS the sheet stays mounted (`blockedOpen` false)
  // until its dismissal completes, so its copy does not blank out during the fade (#859).
  const [blocked, setBlocked] = useState<GatedSource | null>(null);
  const [blockedOpen, setBlockedOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  // The recorder is a nested sheet rather than a launch, so it needs its own visibility —
  // mounted and shown separately, for the same reason as the blocked sheet.
  const [recorderMounted, setRecorderMounted] = useState(false);
  const [recorderOpen, setRecorderOpen] = useState(false);
  // Sequences the nested blocked sheet / recorder against this sheet (#859).
  const gate = useRef(createNestedModalGate(Platform.OS === 'ios'));
  // Source queued to launch after the Modal finishes dismissing (iOS path).
  const queuedLaunch = useRef<Source | null>(null);
  // Synchronous re-entry lock: `busy` state is async and lets a double-tap
  // race two picker launches (the second rejects → spurious onError).
  const launchLock = useRef(false);
  // The same lock for the ASK: the OS dialog is up for as long as the member reads it, and a
  // second row tapped behind it would queue a second request.
  const asking = useRef(false);

  /**
   * The recorder's three endings, as STABLE references.
   *
   * Inline arrows would be re-created on every render of this sheet, and `AudioRecorderSheet`
   * holds them in the dependency array of the `useCallback` its completion effect watches — so
   * each render would rebuild that effect while a recording is in flight. Harmless today (the
   * effect is guarded by its end condition and the work behind it is idempotent), and cheap
   * enough to make correct that it is not worth relying on either property.
   */
  const closeRecorder = useCallback((then?: () => void) => {
    setRecorderOpen(false);
    if (gate.current.closeChild(then) === 'now') setRecorderMounted(false);
  }, []);

  const cancelRecorder = useCallback(() => closeRecorder(), [closeRecorder]);

  const onRecorderGone = useCallback(() => {
    setRecorderMounted(false);
    gate.current.childDismissed();
  }, []);

  // The pick is handed up at once; only hiding this sheet waits for the recorder to be gone.
  const onRecorded = useCallback(
    (m: PickedMedia) => {
      closeRecorder(onClose);
      onPick(m);
    },
    [closeRecorder, onClose, onPick],
  );

  /**
   * A refusal has to take down BOTH sheets, not just the recorder: the composer renders the
   * sentence, and this sheet would otherwise still be covering it. The video path gets that for
   * free — `closeThenLaunch` has already called `onClose()` before a picker can refuse anything
   * — and the recorder, which opens on top instead of launching, has to do it here.
   */
  const onRecorderFailed = useCallback(
    (key: MessageKey) => {
      closeRecorder(onClose);
      onError?.(key);
    },
    [closeRecorder, onClose, onError],
  );

  /** Close the blocked sheet; its content unmounts once it is off screen (at once off iOS). */
  const closeBlocked = useCallback(() => {
    setBlockedOpen(false);
    if (gate.current.closeChild() === 'now') setBlocked(null);
  }, []);

  function onBlockedGone() {
    setBlocked(null);
    gate.current.childDismissed();
  }

  /**
   * Re-read the blocked permission when the app comes back to the foreground (#749).
   *
   * The sheet offers «Apri Impostazioni», and a member who turns the camera on there and comes
   * back found it still saying the camera was off — until they closed the panel and opened it
   * again. Same shape as `notif-prefs.tsx`'s OS-permission peek: re-peek on `active`, never
   * prompt, drop a stale answer. A `granted` result closes the sheet, because what it says is no
   * longer true; the row then launches on its next tap without a dialog. It does not launch on
   * its own, because coming back to the app is not a tap. Only while the sheet is SHOWN: one on
   * its way out must not be closed a second time through the gate.
   */
  useEffect(() => {
    if (blocked == null || !blockedOpen) return;
    let cancelled = false;
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;
      peekPermission(blocked)
        .then((status) => {
          if (!cancelled && status === 'granted') closeBlocked();
        })
        .catch(() => {
          // The peek failed: keep the sheet rather than claim a status we did not read.
        });
    });
    return () => {
      cancelled = true;
      sub.remove();
    };
  }, [blocked, blockedOpen, closeBlocked]);

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
    // The recorder is not a picker (#154): there is no view controller to present, so none of
    // the iOS deferral below applies. It opens as a nested Modal over this one, exactly as
    // `PermissionBlockedSheet` does, and this sheet stays mounted underneath it.
    //
    // No child can be up at this point: a launch starts from a row, and the rows are under the
    // blocked sheet for as long as it is shown and ignore taps while it is on its way out.
    if (source === 'audio') {
      setRecorderMounted(true);
      setRecorderOpen(true);
      return;
    }
    launchLock.current = true;
    if (Platform.OS === 'ios') {
      queuedLaunch.current = source;
      onClose();
      return;
    }
    onClose();
    void doLaunch(source);
  }

  /**
   * Tap a row. The library launches at once — it holds no permission. Every other source asks
   * the OS first: `ensure*Permission` reads the status and fires the system dialog only when the
   * OS can still ask, so an already-granted source launches without one and a blocked one never
   * fires a dialog iOS would not show. Nothing of ours is rendered before that dialog (#908).
   */
  async function onRow(source: Source) {
    if (busy || launchLock.current || asking.current || gate.current.isClosing()) return;
    if (source === 'library') {
      closeThenLaunch(source);
      return;
    }
    asking.current = true;
    try {
      const status = await ensurePermission(source);
      if (status === 'granted') closeThenLaunch(source);
      else if (status === 'blocked') {
        setBlocked(source);
        setBlockedOpen(true);
      }
      // `denied`: the member said no and the OS can ask again (Android, after one explicit
      // «Don't allow»). Nothing to add to what they just chose — the rows are still there, and
      // the next tap asks again.
    } catch {
      // The permission read or request itself threw. Same ending as a picker that threw: take
      // the sheet down so the composer's sentence is not hidden behind it.
      onClose();
      onError?.('media.failed');
    } finally {
      asking.current = false;
    }
  }

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      onShow={() => {
        // Re-shown sheet must never fire a stale launch: if onDismiss was ever
        // missed (iOS double-dismiss edge with a nested child), reset here.
        queuedLaunch.current = null;
        launchLock.current = false;
        asking.current = false;
        gate.current.reset();
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
            {/* The title names what the rows below actually offer: a stills-only sheet
              (avatars, chat) promised «foto o video» while rendering no video row (#155).
              Derived from allowVideo FIRST so an audio-without-video sheet — no caller today,
              and no catalog key — degrades to the photo title rather than promising a video
              row line 280 will not render. Its first real caller owes it copy of its own. */}
            {t(
              allowVideo
                ? allowAudio
                  ? 'media.sheet.titleAudio'
                  : 'media.sheet.title'
                : 'media.sheet.titlePhoto',
              locale,
            )}
          </Text>
          {/* Gated with the title (#155): «aggiungili al tuo percorso» sells moments — wrong
            promise over a chat attach or an avatar. The stills sub just names the two rows. */}
          <Text className="mt-1 text-center text-[14px] leading-5 text-faint">
            {t(allowVideo ? 'media.sheet.sub' : 'media.sheet.subPhoto', locale)}
          </Text>

          <View className="mt-6 gap-2">
            <Row
              label={t('media.sheet.photo', locale)}
              disabled={busy}
              onPress={() => void onRow('photo')}
            />
            {allowVideo ? (
              <Row
                label={t('media.sheet.video', locale)}
                disabled={busy}
                onPress={() => void onRow('video')}
              />
            ) : null}
            {allowAudio ? (
              <Row
                label={t('media.sheet.audio', locale)}
                disabled={busy}
                onPress={() => void onRow('audio')}
              />
            ) : null}
            <Row
              label={t('media.sheet.library', locale)}
              disabled={busy}
              onPress={() => void onRow('library')}
            />
            {/*
             * The exit (#518 follow-up). Once the scrim above stops being an accessibility
             * element, tapping outside is no longer reachable by a screen reader — and this
             * sheet had no other close control, so without this row a VoiceOver user could
             * reach the three options and nothing that leaves. `onAccessibilityEscape` cannot
             * stand in for it: RN fires the escape gesture only "when accessible is true"
             * (RN's ViewAccessibility.d.ts), which is precisely what is turned off above.
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

      {recorderMounted ? (
        <AudioRecorderSheet
          visible={recorderOpen}
          locale={locale}
          onRecorded={onRecorded}
          onCancel={cancelRecorder}
          onFailed={onRecorderFailed}
          onDismissed={onRecorderGone}
        />
      ) : null}

      {blocked ? (
        <PermissionBlockedSheet
          kind={blocked === 'audio' ? 'microphone' : 'camera'}
          visible={blockedOpen}
          locale={locale}
          onDismiss={closeBlocked}
          onDismissed={onBlockedGone}
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
      className={`min-h-[52px] flex-row items-center rounded-ctl px-4 py-3 ${disabled ? 'opacity-40' : ''}`}
      disabled={disabled}
      accessibilityRole="button"
      onPress={onPress}
    >
      <Text className="text-[16px] text-foreground">{label}</Text>
    </Pressable>
  );
}

// --- helpers ---------------------------------------------------------------

/**
 * Which permission a row needs, read WITHOUT prompting.
 *
 * One function per direction rather than a ternary at each call site: the failure mode of
 * getting the mapping wrong is silent — a row that reads the camera before opening the recorder
 * reports «granted» from the wrong permission and launches into one the member was never asked
 * about.
 *
 * `audio` is never reached from a sheet without `allowAudio`, because no row renders.
 */
function peekPermission(source: GatedSource): Promise<PermStatus> {
  if (source === 'audio') return peekMicrophonePermission();
  return peekCameraPermission();
}

/** The same mapping for the request that may actually show the OS dialog. */
function ensurePermission(source: GatedSource): Promise<PermStatus> {
  if (source === 'audio') return ensureMicrophonePermission();
  return ensureCameraPermission();
}

/**
 * `audio` never reaches here: {@link closeThenLaunch} returns before `doLaunch` for it, because
 * a recorder is a nested sheet and not a picker to launch. It is in the {@link Source} union
 * all the same, so the exhaustive read below would be a lie without saying so.
 */
function pickForSource(source: Source, allowVideo: boolean): Promise<MediaPickResult> {
  if (source === 'photo') return capturePhoto();
  if (source === 'video') return recordVideo();
  return pickFromLibrary({ allowVideo });
}
