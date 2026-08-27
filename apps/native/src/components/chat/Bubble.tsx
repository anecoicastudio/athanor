import { useRouter } from 'expo-router';
import { memberLabel } from '@athanor/core';
import { type Locale, type MessageKey, t } from '@athanor/i18n';
import type { Message } from '@athanor/schemas';
import { Pressable, Text, View } from '@/tw';
import { HIT_SLOP } from '@/lib/a11y';
import { Avatar } from '@/components/Avatar';
import { MediaFrame } from '@/components/media/MediaFrame';

/** Small enough to sit under a bubble's last line without stealing width from the text. */
const AVATAR_SIZE = 28;

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
      className="overflow-hidden rounded-xl bg-raise-2"
      style={{ width: IMAGE_WIDTH, aspectRatio: IMAGE_RATIO }}
    />
  );
}

/**
 * One chat message. `me` (own, aura tint — the "me" bubble is an allowed cyan surface, rule #4),
 * `them` (peer, raised surface), or `sys`/`prompt` ice-breakers (centered, server-authored by key).
 * No glow on bubbles (rule #4 — glow is for moment-grade events only).
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
}) {
  const router = useRouter();
  if (message.kind === 'system' || message.kind === 'prompt') {
    // prompt_key is server-controlled (the 4 ice-breaker keys exist in both catalogs); guard the
    // cast anyway so an unknown key falls back to body rather than rendering `undefined`.
    const label =
      (message.prompt_key ? t(message.prompt_key as MessageKey, locale) : undefined) ??
      message.body ??
      '';
    return (
      <View className="my-1 items-center px-6">
        <Text className="text-center text-[13px] italic leading-5 text-faint">{label}</Text>
      </View>
    );
  }
  const mine = message.sender_id === myId;
  // A body-less image renders the frame alone; a caption sits under its image in one bubble.
  // ONE content block for both arms — only the text color differs, so a change to the media
  // or caption layout cannot land on one side and drift the other.
  const hasMedia = Boolean(message.media_url);
  const content = (textClass: string) => (
    <>
      {hasMedia ? <BubbleImage url={mediaUrl} isLoading={mediaLoading} locale={locale} /> : null}
      {message.body ? (
        <Text className={`text-[15px] leading-5 ${textClass} ${hasMedia ? 'px-2.5 py-1.5' : ''}`}>
          {message.body}
        </Text>
      ) : null}
    </>
  );
  const bubblePad = hasMedia ? 'p-1.5' : 'px-4 py-2';
  if (mine) {
    return (
      <View className="my-1 max-w-[80%] self-end">
        <View className={`rounded-2xl bg-aura ${bubblePad}`}>{content('text-on-aura')}</View>
      </View>
    );
  }
  return (
    <View className="my-1 max-w-[80%] flex-row items-end gap-2 self-start">
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
            onPress={() => router.push(`/(modal)/user/${message.sender_id}`)}
          >
            <Avatar
              handle={peer?.handle ?? null}
              displayName={peer?.displayName ?? null}
              avatarPath={peer?.avatarPath ?? null}
              size={AVATAR_SIZE}
            />
          </Pressable>
        ) : null}
      </View>
      <View className={`flex-1 rounded-2xl border border-hair bg-raise ${bubblePad}`}>
        {content('text-foreground')}
      </View>
    </View>
  );
}
