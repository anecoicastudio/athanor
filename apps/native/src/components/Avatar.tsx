import { Image } from 'expo-image';
import { StyleSheet } from 'react-native';
import { Text, View } from '@/tw';
import { useAvatarUrl } from '@/lib/media/avatar-url';
import { useReducedMotion } from '@/hooks/use-reduced-motion';

/**
 * Circle avatar (DESIGN.md §8). Renders the member's photo when they have set one, and the
 * initial otherwise — the fallback is a first-class state, not a placeholder for a missing
 * upload, because name and photo are optional by product decision (#75).
 *
 * The initial comes from `displayName` when there is one and the handle otherwise, so a member
 * called «Stella» is an S rather than the letter their auto-derived handle happens to start with.
 *
 * `avatarPath` is a storage key in the private `avatars` bucket, never a URL. Signing happens
 * here, per leaf, and `useAvatarUrl` coalesces a list's worth of leaves into one request — see
 * `lib/media/signed-url-batch.ts`. The oro evolutionary-story ring is still deferred to M3.
 */
export function Avatar({
  handle,
  size = 72,
  displayName = null,
  avatarPath = null,
}: {
  handle: string | null;
  size?: number;
  /** Optional human name (#76) — sources the initial and the screen-reader label. */
  displayName?: string | null;
  /** Optional `avatars` storage key (#76). Null, or a key that fails to sign, falls back to the initial. */
  avatarPath?: string | null;
}) {
  const url = useAvatarUrl(avatarPath);
  const reduce = useReducedMotion();
  const initial = (displayName?.trim() || handle || '?').charAt(0).toUpperCase();

  return (
    <View
      className="items-center justify-center overflow-hidden rounded-full bg-surface-muted"
      style={{ width: size, height: size }}
      // The label names the person either way, so a screen reader reads the same thing whether
      // or not the photo resolved.
      accessible
      accessibilityLabel={displayName?.trim() || (handle ? `@${handle}` : undefined)}
    >
      {url ? (
        <Image
          source={{ uri: url }}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          // Reduced motion replaces transitions with a cut (DESIGN §10).
          transition={reduce ? 0 : 200}
          // Rows recycle in a list; without this a scrolled-away face can flash in the row that
          // took its place.
          recyclingKey={url}
        />
      ) : (
        <Text
          className="font-semibold text-foreground"
          style={{ fontSize: Math.round(size * 0.4) }}
        >
          {initial}
        </Text>
      )}
    </View>
  );
}
