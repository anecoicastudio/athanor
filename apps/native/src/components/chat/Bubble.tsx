import { type Locale, type MessageKey, t } from '@athanor/i18n';
import type { Message } from '@athanor/schemas';
import { Text, View } from '@/tw';

/**
 * One chat message. `me` (own, aura tint — the "me" bubble is an allowed cyan surface, rule #4),
 * `them` (peer, raised surface), or `sys`/`prompt` ice-breakers (centered, server-authored by key).
 * No glow on bubbles (rule #4 — glow is for moment-grade events only).
 */
export function Bubble({
  message,
  myId,
  locale,
}: {
  message: Message;
  myId: string;
  locale: Locale;
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
  return (
    <View className={`my-1 max-w-[80%] ${mine ? 'self-end' : 'self-start'}`}>
      <View className={`rounded-2xl px-4 py-2 ${mine ? 'bg-aura' : 'border border-hair bg-raise'}`}>
        <Text className={`text-[15px] leading-5 ${mine ? 'text-on-aura' : 'text-foreground'}`}>
          {message.body}
        </Text>
      </View>
    </View>
  );
}
