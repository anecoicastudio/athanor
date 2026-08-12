import { type Locale, type MessageKey, t } from '@athanor/i18n';
import type { Message } from '@athanor/schemas';
import { Text, View } from '@/tw';
import { Avatar } from '@/components/Avatar';

/** Small enough to sit under a bubble's last line without stealing width from the text. */
const AVATAR_SIZE = 28;

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
 * left-aligned with itself while only the first of the run shows the face.
 */
export function Bubble({
  message,
  myId,
  locale,
  peer,
  showPeerAvatar = false,
}: {
  message: Message;
  myId: string;
  locale: Locale;
  /** The other party's identity (#76) — absent while the conversation row is still loading. */
  peer?: { handle: string | null; displayName: string | null; avatarPath: string | null } | null;
  /** True on the first bubble of a run from the peer; the rest keep the gutter and skip the face. */
  showPeerAvatar?: boolean;
}) {
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
  if (mine) {
    return (
      <View className="my-1 max-w-[80%] self-end">
        <View className="rounded-2xl bg-aura px-4 py-2">
          <Text className="text-[15px] leading-5 text-on-aura">{message.body}</Text>
        </View>
      </View>
    );
  }
  return (
    <View className="my-1 max-w-[80%] flex-row items-end gap-2 self-start">
      {/* The gutter is always AVATAR_SIZE wide; only the first bubble of a run fills it. */}
      <View style={{ width: AVATAR_SIZE }}>
        {showPeerAvatar ? (
          <Avatar
            handle={peer?.handle ?? null}
            displayName={peer?.displayName ?? null}
            avatarPath={peer?.avatarPath ?? null}
            size={AVATAR_SIZE}
          />
        ) : null}
      </View>
      <View className="flex-1 rounded-2xl border border-hair bg-raise px-4 py-2">
        <Text className="text-[15px] leading-5 text-foreground">{message.body}</Text>
      </View>
    </View>
  );
}
