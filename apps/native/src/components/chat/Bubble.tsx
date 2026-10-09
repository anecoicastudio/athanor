import { useRouter } from 'expo-router';
import { memberLabel } from '@athanor/core';
import { type Locale, type MessageKey, t } from '@athanor/i18n';
import type { Message } from '@athanor/schemas';
import { Pressable, Text, View, cn } from '@/tw';
import { HIT_SLOP } from '@/lib/a11y';
import { PRESS_DIM } from '@/lib/press';
import { Avatar } from '@/components/Avatar';
import { MediaFrame } from '@/components/media/MediaFrame';

/** Small enough to sit under a bubble's last line without stealing width from the text. */
const AVATAR_SIZE = 30;

/** Module-scope so the array is not rebuilt on every bubble render of a long thread. */
const LONG_PRESS_ACTION = [{ name: 'longpress' as const }];

/**
 * What a screen reader announces for a bubble that carries an affordance — the peer's action
 * sheet (#574), the photo viewer (#576), or both.
 *
 * An image-only message has no text of its own, so «Foto» is the whole label — without it the
 * button would announce as nothing but its hint. A captioned image announces both, image
 * first, matching the order the bubble renders them in.
 */
function bubbleLabel(message: Message, locale: Locale): string {
  const photo = message.media_url ? t('chat.a11y.imageMessage', locale) : null;
  return [photo, message.body].filter(Boolean).join(', ');
}

/**
 * The hint for what pressing actually does, which since #576 is no longer one thing. A peer's
 * photo carries BOTH gestures — tap opens the viewer, long press opens the actions — and a hint
 * naming only one of them would hide the other from the one member who cannot find it by trying:
 * a long press has no visual affordance, and VoiceOver reaches it only through the declared
 * `longpress` action below.
 */
function bubbleHint(
  locale: Locale,
  canOpenPhoto: boolean,
  hasActions: boolean,
): string | undefined {
  if (canOpenPhoto && hasActions) return t('chat.a11y.photoAndActions', locale);
  if (canOpenPhoto) return t('chat.a11y.openPhoto', locale);
  // No fallback: a bubble with neither affordance is not a button at all, and returning the
  // actions hint for it would announce a gesture that does nothing.
  return hasActions ? t('chat.a11y.messageActions', locale) : undefined;
}

/**
 * Fixed frame for a chat image (#155). `messages` stores no width/height (unlike `post_media`),
 * so the ratio cannot be per-row data: one landscape box, image covered, keeps a thread's
 * bubbles from re-flowing as each image loads. 4/3 over 4/5 because a chat column is narrow
 * and a tall frame would eat the viewport one message at a time.
 */
const IMAGE_WIDTH = 220;
const IMAGE_RATIO = 4 / 3;

/** The image block inside a bubble — same three states as every media surface (#135). */
function BubbleImage({
  url,
  isLoading,
  locale,
}: {
  url?: string;
  isLoading: boolean;
  locale: Locale;
}) {
  return (
    <MediaFrame
      kind="photo"
      url={url}
      isLoading={isLoading}
      locale={locale}
      className="overflow-hidden rounded-[14px] bg-background"
      style={{ width: IMAGE_WIDTH, aspectRatio: IMAGE_RATIO }}
    />
  );
}

/**
 * The words of a server-authored row: the Momento banner (`system`) or one of the three
 * ice-breaker prompts (`prompt`). `prompt_key` is server-controlled (the four keys exist in both
 * catalogs); the cast is guarded anyway, so an unknown key falls back to the body rather than
 * rendering `undefined`. The chat screen draws the prompts itself, as pills, with this.
 */
export function serverLine(message: Message, locale: Locale): string {
  return (
    (message.prompt_key ? t(message.prompt_key as MessageKey, locale) : undefined) ??
    message.body ??
    ''
  );
}

/**
 * One chat message (DESIGN §8.8; Galleria since 2026-10-09, #921). Own: the white fill with
 * black text, at the right. The peer's: charcoal `surface` with a hairline, at the left. Both
 * radius 20, the text in body size. A server-authored row (the Momento banner, or a prompt that
 * reaches this component) is a centred small grey italic line. Nothing here is cyan and nothing
 * glows: a sent message is not one of the five marks (DESIGN §2.3).
 *
 * Incoming bubbles carry the peer's small avatar (#76). DESIGN.md §8 lists Avatar for the top
 * bar and the profile hero and says nothing about bubbles, so this is a deliberate addition
 * agreed for #76, not an inference from the table. It is one-sided on purpose: an avatar beside
 * your OWN bubble tells you nothing you don't know, and the pair would halve the usable width.
 * The gutter is reserved on every incoming bubble so a run of consecutive messages stays
 * left-aligned with itself while only the LAST of the run shows the face — last, not first,
 * because the gutter is bottom-aligned and that is the row the face lines up with.
 */
export function Bubble({
  message,
  myId,
  locale,
  peer,
  showPeerAvatar = false,
  mediaUrl,
  mediaLoading = false,
  onLongPress,
  onImagePress,
}: {
  message: Message;
  myId: string;
  locale: Locale;
  /** The other party's identity (#76) — absent while the conversation row is still loading. */
  peer?: { handle: string | null; displayName: string | null; avatarPath: string | null } | null;
  /** True on the LAST bubble of a run from the peer; the rest keep the gutter and skip the face. */
  showPeerAvatar?: boolean;
  /** Signed URL for `message.media_url` (#155), from the screen's one `useSignedUrls` call. */
  mediaUrl?: string;
  /** That signing query's `isLoading` — what separates "signing" from "gone" (#135). */
  mediaLoading?: boolean;
  /**
   * Opens the per-message action sheet (#574). Passed for the PEER's bubbles only — reporting
   * your own message names nobody, and an ice-breaker is server-authored copy with no author
   * to report. Absent means the bubble stays a plain View: the affordance is what makes the
   * surface an accessibility element, so a bubble that has none must not become one.
   */
  onLongPress?: () => void;
  /**
   * Opens the fullscreen photo viewer (#576). Passed for any bubble carrying an image, own or
   * peer's — an own photo is cropped by the same 220pt · 4/3 frame, so it wants the same way to
   * see the whole of it. Absent (or on a text-only message) leaves the bubble as it was.
   */
  onImagePress?: () => void;
}) {
  const router = useRouter();
  if (message.kind === 'system' || message.kind === 'prompt') {
    return (
      <View className="my-1.5 items-center px-5">
        <Text className="text-center type-small italic text-muted-foreground">
          {serverLine(message, locale)}
        </Text>
      </View>
    );
  }
  const mine = message.sender_id === myId;
  // A body-less image renders the frame alone; a caption sits under its image in one bubble.
  // ONE content block for both arms — only the text colour differs, so a change to the media
  // or caption layout cannot land on one side and drift the other.
  const hasMedia = Boolean(message.media_url);
  const content = (textClass: string) => (
    <>
      {hasMedia ? <BubbleImage url={mediaUrl} isLoading={mediaLoading} locale={locale} /> : null}
      {message.body ? (
        <Text className={cn('type-body', textClass, hasMedia ? 'px-2.5 py-1.5' : null)}>
          {message.body}
        </Text>
      ) : null}
    </>
  );
  // The prototype's `.me` / `.you` padding (10 and 16). A photo takes 6 instead, so its
  // radius-14 frame follows the bubble's radius-20 corner.
  const bubblePad = hasMedia ? 'p-1.5' : 'px-4 py-[10px]';
  // The tap only exists where there is something to open. A text bubble stays a plain View for
  // the same reason an unreportable one does: the affordance is what makes a surface an
  // accessibility element, and a bubble with none must not become one.
  const canOpenPhoto = hasMedia && onImagePress != null;
  if (mine) {
    const own = cn('rounded-[20px] bg-foreground', bubblePad);
    return (
      <View className="my-1.5 max-w-[80%] self-end">
        {canOpenPhoto ? (
          <Pressable
            className={cn(own, PRESS_DIM)}
            onPress={onImagePress}
            accessibilityRole="button"
            accessibilityLabel={bubbleLabel(message, locale)}
            accessibilityHint={bubbleHint(locale, true, false)}
          >
            {content('text-background')}
          </Pressable>
        ) : (
          <View className={own}>{content('text-background')}</View>
        )}
      </View>
    );
  }
  // `shrink`, not `flex-1` (2026-10-09): the bubble is as wide as its words or its photo, up to
  // what the row leaves it (the row is capped at 80% and holds the avatar's gutter and the gap),
  // as the prototype's `.you`. With `flex-1` every incoming bubble took all of it and a photo
  // stood beside a blank band. Seen that day on the iPhone SE simulator (default
  // and AX5) and on the moto g17 (font scale 1.0 and 2.0): a one-line message kept all its words.
  const peerBubble = cn('shrink rounded-[20px] border border-hair bg-surface', bubblePad);
  return (
    <View className="my-1.5 max-w-[80%] flex-row items-end gap-2 self-start">
      {/* The gutter is always AVATAR_SIZE wide; only the last bubble of a run fills it.
          The face taps through to the peer's profile (#356) — same link as the header
          identity block, so a reader deep in a thread never has to scroll up to reach it. */}
      <View style={{ width: AVATAR_SIZE }}>
        {showPeerAvatar ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('connection.a11y.open', locale, {
              name: memberLabel(peer?.displayName, peer?.handle) ?? '—',
            })}
            hitSlop={HIT_SLOP}
            className={PRESS_DIM}
            onPress={() => router.push(`/(modal)/user/${message.sender_id}`)}
          >
            <Avatar
              decorative
              handle={peer?.handle ?? null}
              displayName={peer?.displayName ?? null}
              avatarPath={peer?.avatarPath ?? null}
              size={AVATAR_SIZE}
            />
          </Pressable>
        ) : null}
      </View>
      {onLongPress || canOpenPhoto ? (
        <Pressable
          className={cn(peerBubble, PRESS_DIM)}
          // Both gestures on ONE Pressable, never two nested ones: on iOS the inner control
          // would be unreachable to VoiceOver (source-audit §21), and a fresh Pressable around
          // the image is exactly the shape that would take the report affordance away from the
          // image-only messages #574 was filed about.
          {...(canOpenPhoto ? { onPress: onImagePress } : {})}
          // The gesture, declared. RN fires `onAccessibilityAction` for the standard
          // 'longpress' action, which is the only way a screen-reader user reaches a long
          // press at all — without it the sheet would be mouse-and-finger only.
          {...(onLongPress
            ? {
                onLongPress,
                accessibilityActions: LONG_PRESS_ACTION,
                onAccessibilityAction: onLongPress,
              }
            : {})}
          accessibilityRole="button"
          // ONE composed label (the MomentTile precedent, #292): a Pressable is an
          // accessibility element and on iOS an atomic one, so anything `accessible` nested
          // inside it — the image frame's own label — may never be spoken. It has to ride the
          // button's label instead.
          accessibilityLabel={bubbleLabel(message, locale)}
          accessibilityHint={bubbleHint(locale, canOpenPhoto, onLongPress != null)}
        >
          {content('text-foreground')}
        </Pressable>
      ) : (
        <View className={peerBubble}>{content('text-foreground')}</View>
      )}
    </View>
  );
}
