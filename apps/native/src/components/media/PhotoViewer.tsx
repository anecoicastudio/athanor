import { useEffect, useMemo, useRef } from 'react';
import { Modal, PanResponder } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { t } from '@athanor/i18n';
import type { Locale } from '@athanor/schemas';
import { Text, View } from '@/tw';
import { MediaFrame } from '@/components/media/MediaFrame';
import { ModalHeader } from '@/components/ModalHeader';
import { Screen } from '@/components/Screen';
import { dismissesOnRelease, shouldClaimViewerDrag } from '@/lib/viewer-gesture';

/**
 * Fullscreen viewer for ONE photo that is already signed (#576). Tap or swipe down dismisses,
 * and the ✕ is the dismissal a screen reader can reach — the ruling asks for a labelled control,
 * not tap-only.
 *
 * Not `Lightbox`, deliberately: that one is the Momenti gallery — a `Moment[]` with dots,
 * captions and a real video player, cover-cropped into the 4/5 box those items are authored in.
 * This is the other shape: a single arbitrary-ratio photo, `contain` rather than `cover`,
 * because undoing the caller's crop is the entire reason a viewer opens.
 *
 * NO pinch-zoom (Marco's 2026-08-30 ruling on #576). The gesture machinery is not worth its
 * weight in Expo Go for v1 and it can be added inside this component later; nothing here is
 * shaped around its absence.
 *
 * Takes the RESOLVED url rather than a storage path. The chat screen already holds one
 * `useSignedUrls('chat-media', …)` for the whole thread, and its query key is the sorted path
 * SET (`lib/media/use-signed-urls.ts`) — so a viewer that signed its own single path would miss
 * that cache entirely and re-mint a credential the caller is already holding.
 */
export function PhotoViewer({
  visible,
  url,
  isLoading,
  label,
  caption,
  locale,
  onClose,
}: {
  visible: boolean;
  /** Signed URL for the photo, from the caller's `useSignedUrls`. */
  url?: string;
  /** That signing query's `isLoading` — what separates "signing" from "gone" (#135). */
  isLoading: boolean;
  /** The header word, ALREADY TRANSLATED (the `ModalHeader.backLabel` convention): the viewer
   * is generic, so the noun for what is being viewed belongs to the caller. */
  label: string;
  /** The message's own text, if it had any — shown under the photo, never truncated. */
  caption?: string | null;
  locale: Locale;
  onClose: () => void;
}) {
  // What the fade-out shows. `visible` flips before the caller can clear what it was showing —
  // the chat screen nulls its `viewing` message in the same handler that closes this — and the
  // Modal keeps rendering its children for the length of the animation. Rendering the live props
  // through that would hand `MediaFrame` a `url` of undefined with nothing loading, i.e. the
  // terminal «this photo won't load» state, so every dismissal would flash an error where the
  // photo was. The ref is written from an effect rather than during render, so the close render
  // still reads what the last OPEN render was given.
  const last = useRef<{ url?: string; caption?: string | null }>({});
  useEffect(() => {
    if (visible) last.current = { url, caption };
  }, [visible, url, caption]);
  const shown = visible ? { url, caption } : last.current;

  const pan = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: (_e, g) => shouldClaimViewerDrag(g.dx, g.dy),
        // What a release means lives in `lib/viewer-gesture.ts`, tested — a PanResponder
        // config cannot be asserted, and "an upward flick does not dismiss" is exactly the
        // kind of tuning that regresses silently.
        onPanResponderRelease: (_e, g) => {
          if (dismissesOnRelease(g.dx, g.dy)) onClose();
        },
      }),
    [onClose],
  );

  return (
    // onRequestClose is the Android hardware back button — the third way out, and the one
    // neither the ✕ nor the gestures cover.
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      {/* RN <Modal> is its own native root — the app-level provider doesn't reach in (#161). */}
      <SafeAreaProvider>
        <Screen>
          {/* Immersive media chrome: ✕ left, label left-aligned (DESIGN §6). */}
          <ModalHeader
            leading="close"
            backLabel={t('common.close', locale)}
            onBack={onClose}
            titleSlot={<Text className="text-sm text-faint">{label}</Text>}
          />

          {/* The stage stays a plain View: a Pressable here would be an accessibility element,
            and on iOS an atomic one, which would swallow the frame's own «Caricamento…» and
            «Questa foto non si carica» labels. The ✕ above is the reachable exit; these
            gestures are the sighted shortcut to it. */}
          <View className="flex-1" {...pan.panHandlers}>
            <MediaFrame
              kind="photo"
              url={shown.url}
              isLoading={visible && isLoading}
              locale={locale}
              contentFit="contain"
              className="absolute inset-0"
            />
          </View>

          {shown.caption ? (
            <Text className="px-gutter pb-10 pt-3 text-center text-foreground">
              {shown.caption}
            </Text>
          ) : (
            <View className="pb-10" />
          )}
        </Screen>
      </SafeAreaProvider>
    </Modal>
  );
}
