import { Modal, StyleSheet } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useVideoPlayer, VideoView } from 'expo-video';
import { t } from '@athanor/i18n';
import type { Locale } from '@athanor/schemas';
import type { Moment } from '@/types/moment';
import { Pressable, Text, View } from '@/tw';
import { MediaFrame } from '@/components/media/MediaFrame';
import { ModalHeader } from '@/components/ModalHeader';
import { Screen } from '@/components/Screen';
import { useVideoFailure } from '@/lib/media/use-video-failure';

/**
 * Fullscreen Momento viewer (frontend `01` §3.6). Opened from the Profilo
 * gallery or the full grid. Renders the live media for the current item from
 * signed URLs (`urls`, path→url): a cover photo or a real `expo-video` player.
 *
 * The prototype draws no lightbox, so its look is `base.css`'s (#921): the media stands in a
 * radius-14 `surface` frame with a hairline drawn over it, the caption under it in small text,
 * and the place in the set is a foreground dot among hairline ones. No cyan: a page dot is not
 * one of the five marks (DESIGN §2.3).
 */
export function Lightbox({
  moments,
  urls,
  urlsLoading,
  index,
  locale,
  onClose,
  onIndexChange,
}: {
  moments: Moment[];
  /** Signed URLs by storage path (from `useSignedUrls('moments', …)`). */
  urls: Record<string, string>;
  /** That same hook's `isLoading` — it is what separates "signing" from "gone". */
  urlsLoading: boolean;
  index: number | null;
  locale: Locale;
  onClose: () => void;
  onIndexChange: (index: number) => void;
}) {
  const open = index !== null && index >= 0 && index < moments.length;
  const current = open ? moments[index] : null;
  const currentUrl = current ? urls[current.media_path] : undefined;

  const step = () => {
    if (index === null || moments.length === 0) return;
    onIndexChange((index + 1) % moments.length);
  };

  return (
    <Modal visible={open} transparent animationType="fade" onRequestClose={onClose}>
      {/* RN <Modal> is its own native root — the app-level provider doesn't reach in (#161). */}
      <SafeAreaProvider>
        <Screen>
          {/* lb-top — immersive media chrome: close left, label left-aligned (DESIGN §6). */}
          <ModalHeader
            leading="close"
            backLabel={t('common.back', locale)}
            onBack={onClose}
            titleSlot={
              <Text className="type-small text-muted-foreground">
                {t('lightbox.label', locale)}
              </Text>
            }
          />

          {/* lb-stage — tap → next. No press dim: the stage is the photo, and it would flicker
              at every step. */}
          <Pressable className="flex-1 items-center justify-center px-5" onPress={step}>
            <View className="aspect-[4/5] w-full overflow-hidden rounded-[14px] bg-surface">
              {current?.kind === 'video' ? (
                <MediaFrame
                  kind="video"
                  url={currentUrl}
                  isLoading={urlsLoading}
                  locale={locale}
                  className="absolute inset-0"
                >
                  {(uri, onFailure) => (
                    <LightboxVideo key={current.id} uri={uri} onError={onFailure} />
                  )}
                </MediaFrame>
              ) : (
                <MediaFrame
                  kind="photo"
                  url={currentUrl}
                  isLoading={urlsLoading}
                  locale={locale}
                  className="absolute inset-0"
                />
              )}
              <View
                pointerEvents="none"
                className="absolute inset-0 rounded-[14px] border border-hair"
              />
            </View>
          </Pressable>

          {/* lb-cap */}
          {current?.caption ? (
            <Text className="type-small px-5 pb-3 text-center text-foreground">
              {current.caption}
            </Text>
          ) : null}

          {/* lb-nav dots */}
          {moments.length > 1 ? (
            <View className="flex-row items-center justify-center gap-2 pb-10">
              {moments.map((m, i) => (
                <View
                  key={m.id}
                  className={`h-1.5 w-1.5 rounded-full ${i === index ? 'bg-foreground' : 'bg-hair'}`}
                />
              ))}
            </View>
          ) : (
            <View className="pb-10" />
          )}
        </Screen>
      </SafeAreaProvider>
    </Modal>
  );
}

/**
 * Real video playback for the current Momento. A child component so the
 * `useVideoPlayer` hook never sits behind the photo/video conditional in
 * `Lightbox` (hooks rules) — it mounts only when a video is shown, and a fresh
 * instance per `uri` (keyed by the caller) owns its own player.
 */
function LightboxVideo({ uri, onError }: { uri: string; onError: () => void }) {
  const player = useVideoPlayer(uri, (p) => {
    p.loop = true;
    p.play();
  });
  // A dead URL flips the frame to unavailable (#278) instead of a player that never plays.
  useVideoFailure(player, onError);
  return <VideoView player={player} style={StyleSheet.absoluteFill} contentFit="cover" />;
}
