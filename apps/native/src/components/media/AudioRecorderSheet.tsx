import { useCallback, useEffect, useRef, useState } from 'react';
import { Modal, Platform } from 'react-native';
import { useAudioRecorder, useAudioRecorderState } from 'expo-audio';
import { t, type MessageKey } from '@athanor/i18n';
import type { Locale } from '@athanor/schemas';
import { Pressable, Text, View } from '@/tw';
import { Button } from '@/components/Button';
import { MODAL_A11Y } from '@/lib/a11y';
import { devWarn } from '@/lib/log';
import { formatDuration } from '@/lib/media/format';
import {
  AUDIO_REJECTION_MESSAGE,
  audioContentTypeFor,
  reachedClipCap,
  recordedAudio,
  recordedSeconds,
} from '@/lib/media/audio-recording';
import type { PickedMedia } from '@/lib/media/pick';
import {
  AUDIO_RECORDING_OPTIONS,
  AUDIO_RECORDING_START,
  enterRecordingMode,
  leaveRecordingMode,
} from '@/lib/media/record-audio';

/** How often the recorder's elapsed time is polled. 4 Hz reads as a live timer without churn. */
const POLL_MS = 250;

/**
 * The in-app voice recorder (#154).
 *
 * The audio path existed end to end before this — the `media_kind` enum, the `post-media`
 * bucket's `audio/mp4`, `media-process`'s MP4 strip, `derivePostType`, `PostMedia`'s player —
 * with no way to produce a single row. `expo-image-picker` has no audio media type, so a
 * recorder is the only door there can be, and this is it.
 *
 * Rendered as a nested Modal from `MediaSheet`, the way `PermissionPrimer` is. It does NOT use
 * that component's close-then-launch dance, and the difference is the point: that dance exists
 * because a native picker view controller silently fails to present while an RN Modal is up.
 * There is no view controller here — the recorder is our own React tree — so it opens on top.
 *
 * ## Two phases, because a third would be a promise this cannot keep
 *
 * Stopping ACCEPTS the take and hands it to the composer, exactly as `capturePhoto` does with
 * a photo. A review step («keep this / record again») was built and removed: without playback
 * it can only show a duration the timer already showed, and `expo-audio`'s player would need
 * its own failure handling here (`PostMedia`'s `DetailAudio` documents why — there is no
 * playback error signal, only a load grace window). The composer tile's ✕ is the undo, which
 * is the same undo every other picked item has.
 *
 * ## The modal recipe, both halves (source-audit §21 and §22)
 *
 * The scrim and the sheet carry `accessible={false}` and neither claims a role or a label: on
 * iOS an accessible view is ATOMIC, so without that flag VoiceOver would focus the pair as one
 * unit and never descend to the controls. And because silencing the scrim also removes
 * tap-outside-to-close from the accessibility tree, «Annulla» below fires the same `cancel`
 * the scrim does — never gated on a busy flag, because backing out matters most while
 * something is in flight.
 *
 * ## Rule #4 — flat cyan, no glow
 *
 * `MediaSheet` states the principle for this whole family: attaching media is not itself a
 * moment. The timer is `text-aura` because a live indicator and a countdown are both on the
 * flat-cyan list, and it is tabular so the digits do not jitter as they climb. No `auraSoft`,
 * no `auraLine`, no shadow — nothing has happened yet.
 */
export function AudioRecorderSheet({
  visible,
  locale,
  onRecorded,
  onCancel,
  onFailed,
}: {
  visible: boolean;
  locale: Locale;
  /** A finished, accepted recording. The sheet closes itself before this runs. */
  onRecorded: (media: PickedMedia) => void;
  /**
   * The member left of their own accord, and nothing is to be said — they know they left.
   * Fired by the scrim and by «Annulla», per source-audit §22.
   */
  onCancel: () => void;
  /**
   * The take ENDED with something to say: a container no bucket accepts, or a recorder that
   * threw. A distinct callback from {@link onCancel} rather than a message alongside it,
   * because the two endings need different things from the caller — a cancel returns the
   * member to the source list, while a refusal has a sentence to deliver and therefore has to
   * take down every sheet standing between them and it. Collapsing them is what left the
   * message rendered underneath a still-visible `MediaSheet`.
   */
  onFailed: (key: MessageKey) => void;
}) {
  const recorder = useAudioRecorder(AUDIO_RECORDING_OPTIONS);
  const state = useAudioRecorderState(recorder, POLL_MS);
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState(false);

  /**
   * The elapsed time at the moment the recorder stopped.
   *
   * A ref, and written from an effect rather than during render, because `durationMillis`
   * belongs to a LIVE recorder: once `stop()` resolves there is no longer a recording to
   * report the length of, and reading it afterwards has no defined answer. The last value seen
   * while running IS the length of the take.
   */
  const lastMs = useRef(0);
  useEffect(() => {
    if (state.isRecording && state.durationMillis > lastMs.current) {
      lastMs.current = state.durationMillis;
    }
  }, [state.isRecording, state.durationMillis]);

  /**
   * Whether the recorder has actually been observed running.
   *
   * `recorder.record()` returns synchronously but the POLLED status lags it by up to
   * `POLL_MS`, so for a beat after `start()` the state still reads `isRecording: false` while
   * `recording` is already true. The completion effect below treats «was recording, now is
   * not» as the take ending — without this ref that condition is true immediately on start and
   * would end every recording before it began.
   */
  const sawRecording = useRef(false);
  useEffect(() => {
    if (state.isRecording) sawRecording.current = true;
  }, [state.isRecording]);

  /** Re-entrancy lock: `busy` is async state and a double-tap races two `stop()` calls. */
  const lock = useRef(false);

  /**
   * The member left while a stop was already in flight.
   *
   * `cancel()` cannot wait for `finish()` and cannot be disabled while busy — source-audit §22
   * requires the exit to stay live exactly when the sheet is working. So the two can genuinely
   * overlap, and without this flag `finish()` would resume after the sheet had closed and hand
   * the composer a recording the member just cancelled.
   */
  const abandoned = useRef(false);

  const finish = useCallback(async () => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    try {
      await recorder.stop();
      const outcome = recordedAudio({
        uri: recorder.uri,
        durationMillis: lastMs.current,
        mimeType: audioContentTypeFor(Platform.OS),
      });
      // The session goes back to playback whether the take was kept or refused: one left in
      // recording mode re-routes ordinary playback for the rest of the app.
      await leaveRecordingMode().catch(() => undefined);
      setRecording(false);
      // Cancelled while `stop()` was awaiting. The bytes are discarded and NOTHING is said:
      // the member already knows they left, and `onCancel` has run once already.
      if (abandoned.current) return;
      if (outcome.outcome === 'picked') {
        onRecorded(outcome.media);
        return;
      }
      // A refusal is an ending, not a state to sit in. On web this is EVERY take — the browser
      // records a container no bucket accepts — so the sheet has to close saying why rather
      // than leave a member tapping a stop button that can never produce anything. `onFailed`
      // and not `onCancel`: the caller has to close the sheet ABOVE this one as well, or the
      // sentence is written to a screen the source list is still covering.
      onFailed(AUDIO_REJECTION_MESSAGE[outcome.reason]);
    } catch (err) {
      // Expo Go has no Sentry (#452), so in dev the console is the only telemetry there is.
      devWarn('audio.stop', err);
      await leaveRecordingMode().catch(() => undefined);
      setRecording(false);
      if (abandoned.current) return;
      onFailed('media.failed');
    } finally {
      setBusy(false);
      lock.current = false;
    }
  }, [recorder, onRecorded, onFailed]);

  /**
   * A take can end without the member pressing Stop, and the two platforms end it differently.
   *
   * **The recorder ended it itself.** `record({ forDuration })` is a NATIVE stop on iOS and
   * Android: it fires at the cap and flips `isRecording` false on its own. Nothing in JS is
   * called, so this is the only signal that a full-length recording finished — and it must be
   * watched rather than inferred from the clock, because once the recorder stops, the polled
   * `durationMillis` stops climbing and what it reports afterwards is native-defined. A
   * watchdog keyed only on the elapsed time would therefore miss the ordinary case of a member
   * letting a recording run to 60 seconds: the sheet would sit on a Stop button over an
   * already-stopped recorder, and the take would survive only if they tapped it again.
   *
   * **Nothing ended it.** `forDuration` has no web implementation (`RecordingStartOptions`
   * documents it iOS/Android only), so in a browser the clock is all there is.
   *
   * Both arms land on the same `finish()`, which is idempotent through `lock`, so a platform
   * that satisfies both conditions at once still finishes exactly once.
   */
  useEffect(() => {
    if (!recording) return;
    const endedItself = sawRecording.current && !state.isRecording;
    if (!endedItself && !reachedClipCap(state.durationMillis)) return;
    void finish();
  }, [recording, state.isRecording, state.durationMillis, finish]);

  /**
   * Never leave the microphone held.
   *
   * The sheet can go away without passing through `finish()` — the composer unmounts, the
   * member is pulled out by a navigation. Both would otherwise leave the recorder running and
   * the audio session in recording mode, which on iOS keeps the mic indicator lit and ducks
   * every other sound in the app until something else changes the category.
   */
  useEffect(
    () => () => {
      void leaveRecordingMode().catch(() => undefined);
    },
    [],
  );

  async function start() {
    if (busy || lock.current) return;
    setBusy(true);
    try {
      lastMs.current = 0;
      sawRecording.current = false;
      abandoned.current = false;
      await enterRecordingMode();
      await recorder.prepareToRecordAsync();
      recorder.record(AUDIO_RECORDING_START);
      setRecording(true);
    } catch (err) {
      devWarn('audio.record', err);
      await leaveRecordingMode().catch(() => undefined);
      onFailed('media.failed');
    } finally {
      setBusy(false);
    }
  }

  /**
   * Leave without keeping anything.
   *
   * Stops the recorder first: closing on a running take would strand the mic exactly as the
   * unmount effect describes. Best-effort — a recorder that never prepared throws here, and a
   * member who asked to leave must leave regardless.
   *
   * **Never gated on `busy` or on `lock`,** per source-audit §22 and `MediaSheet`'s «Annulla»
   * row: an exit that goes dead while the sheet is working restores the dead end for exactly
   * as long as someone is most likely to want out. Which means this really can run while
   * `finish()` is awaiting `recorder.stop()` — so it marks the take abandoned rather than
   * trying to win the race, and `finish()` drops what it was holding when it resumes. Without
   * that flag, cancelling during a stop closed the sheet and then handed the composer the
   * recording anyway.
   *
   * The second `stop()` is skipped while one is already in flight: it would be a redundant
   * native call on a recorder that is already stopping, and `abandoned` has made the outcome
   * moot. Skipping it does not gate the exit — everything below still runs.
   */
  function cancel() {
    abandoned.current = true;
    if (recording && !lock.current) void recorder.stop().catch(() => undefined);
    void leaveRecordingMode().catch(() => undefined);
    setRecording(false);
    onCancel();
  }

  const seconds = recordedSeconds(recording ? state.durationMillis : lastMs.current);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={cancel}>
      {/* scrim — silenced so VoiceOver can descend (§21); `cancel` is the named exit (§22) */}
      <Pressable
        accessible={false}
        className="flex-1 justify-end bg-surface-muted"
        onPress={cancel}
      >
        {/* sheet — stop propagation so taps inside don't dismiss */}
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
            {t('media.record.title', locale)}
          </Text>

          <View className="mt-6 items-center">
            {/*
             * The timer. Flat `aura` — a live indicator, on rule #4's allowed list — and never
             * glowing: nothing has happened yet. Tabular so the digits hold their columns
             * instead of reflowing the row every second.
             *
             * One composed label on the wrapper rather than on the numeral, the MomentTile
             * pairing: a screen reader should hear «12 secondi registrati», not «0:12».
             */}
            <View
              accessible
              accessibilityLabel={t('media.record.elapsed', locale, { sec: seconds })}
            >
              <Text
                className="text-[44px] font-extrabold text-aura"
                style={{ fontVariant: ['tabular-nums'] }}
                accessibilityElementsHidden
                importantForAccessibility="no-hide-descendants"
              >
                {formatDuration(seconds)}
              </Text>
            </View>
            <Text className="mt-2 text-center text-[14px] leading-5 text-faint">
              {t('media.record.hint', locale)}
            </Text>
          </View>

          <View className="mt-8 gap-3">
            {recording ? (
              <Button
                label={t('media.record.stop', locale)}
                variant="light"
                onPress={() => void finish()}
              />
            ) : (
              <Button
                label={t('media.record.start', locale)}
                variant="light"
                loading={busy}
                onPress={() => void start()}
              />
            )}
            {/*
             * The exit (§22). NOT gated on `busy`, unlike the control above and for the same
             * reason `MediaSheet`'s «Annulla» row is not: an exit that goes dead while the
             * sheet is working restores the dead end for exactly as long as a member is most
             * likely to want out.
             */}
            <Pressable
              className="h-[52px] items-center justify-center"
              accessibilityRole="button"
              onPress={cancel}
            >
              <Text className="tracking-widest text-faint">{t('common.cancel', locale)}</Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
