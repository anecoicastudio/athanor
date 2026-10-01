import { useRouter } from 'expo-router';
import { useWindowDimensions } from 'react-native';
import { memberLabel } from '@athanor/core';
import { type Locale, t } from '@athanor/i18n';
import type { ConnectionRequestListItem } from '@athanor/schemas';
import { Pressable, Text, View } from '@/tw';
import { Avatar } from '@/components/Avatar';
import { stacksTrailing } from '@/lib/type-scale';
import { wordLines } from '@/lib/word-lines';

/**
 * One incoming request in the Richieste inbox: avatar + @handle and inline
 * Accetta / Rifiuta actions. Both actions disable while a response is pending.
 * The identity block taps through to the requester's profile (#356) — vetting a
 * stranger belongs BEFORE accepting.
 */
export function ConnectionRequestRow({
  item,
  locale,
  onAccept,
  onDecline,
  pending = false,
}: {
  item: ConnectionRequestListItem;
  locale: Locale;
  onAccept: () => void;
  onDecline: () => void;
  pending?: boolean;
}) {
  const router = useRouter();
  const name = memberLabel(item.peerDisplayName, item.peerHandle) ?? '—';
  // At the accessibility sizes Accetta / Rifiuta move under the identity (#847): beside them
  // the `flex-1` name was left narrower than one word and broke it mid-word.
  const stacked = stacksTrailing(useWindowDimensions().fontScale);
  return (
    <View className={stacked ? 'gap-3 py-3' : 'flex-row items-center gap-3 py-3'}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('connection.a11y.open', locale, { name })}
        className={`${stacked ? '' : 'flex-1 '}flex-row items-center gap-3`}
        onPress={() => router.push(`/(modal)/user/${item.peerId}`)}
      >
        <Avatar
          decorative
          handle={item.peerHandle}
          displayName={item.peerDisplayName}
          avatarPath={item.peerAvatarPath}
          size={48}
        />
        {/* A lone-word handle ellipsizes (DESIGN §10); `connection.a11y.open` keeps it whole. */}
        <Text
          className="flex-1 text-[15px] font-semibold text-foreground"
          numberOfLines={wordLines(name)}
        >
          {name}
        </Text>
      </Pressable>
      <View className="flex-row flex-wrap items-center gap-2">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('connection.a11y.accept', locale, { name })}
          disabled={pending}
          className={`items-center justify-center rounded-full bg-aura px-4 py-2 ${pending ? 'opacity-40' : ''}`}
          onPress={onAccept}
        >
          <Text className="text-[13px] font-semibold text-on-aura">
            {t('connection.accept', locale)}
          </Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('connection.a11y.decline', locale, { name })}
          disabled={pending}
          className={`items-center justify-center rounded-full border border-hair px-4 py-2 ${pending ? 'opacity-40' : ''}`}
          onPress={onDecline}
        >
          <Text className="text-[13px] text-foreground">{t('connection.decline', locale)}</Text>
        </Pressable>
      </View>
    </View>
  );
}
