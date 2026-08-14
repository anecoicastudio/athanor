import { useRouter } from 'expo-router';
import { memberLabel } from '@athanor/core';
import { t } from '@athanor/i18n';
import type { Help, Locale } from '@athanor/schemas';
import { Pressable, Text, View } from '@/tw';
import { Avatar } from '@/components/Avatar';
import { Button } from '@/components/Button';
import { Tag } from '@/components/Tag';
import type { HelperIdentity } from '@/hooks/use-own-dream';

/**
 * One «Aiuti in arrivo» row on the owner's Profilo (frontend `02` §3.4D): who offered
 * help on a tappa + the accept/decline (status='offered') or confirm-done (status='accepted')
 * affordance. Owner-confirm lives here on the accepted offer (simpler than threading it into
 * the tappa row). Confirm-done is the +40/+10 domain event — but this row writes NO Aura
 * (rule #1); the caller's confirmHelpComplete only touches milestone_helps + dream_milestones.
 */
export function IncomingOfferRow({
  help,
  helper,
  locale,
  onAccept,
  onDecline,
  onConfirm,
  mutating = false,
}: {
  help: Help;
  /** null when the helper's profile could not be resolved at all (#76). */
  helper: HelperIdentity | null;
  locale: Locale;
  onAccept: () => void;
  onDecline: () => void;
  onConfirm: () => void;
  mutating?: boolean;
}) {
  const router = useRouter();
  const helperName = memberLabel(helper?.displayName, helper?.handle) ?? '—';
  return (
    <View
      className={`gap-3 rounded-card border border-hair bg-raise p-4 ${mutating ? 'opacity-50' : ''}`}
    >
      {/* who + offer type — the identity block taps through to the helper's profile (#356) */}
      <View className="flex-row items-center gap-3">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('connection.a11y.open', locale, { name: helperName })}
          className="flex-1 flex-row items-center gap-3"
          // 36pt avatar + 4pt each side = the 44pt target, without growing the row.
          hitSlop={{ top: 4, bottom: 4 }}
          onPress={() => router.push(`/(modal)/user/${help.helper_id}`)}
        >
          <Avatar
            handle={helper?.handle ?? null}
            displayName={helper?.displayName ?? null}
            avatarPath={helper?.avatarPath ?? null}
            size={36}
          />
          <Text className="flex-1 text-[15px] font-semibold text-foreground" numberOfLines={1}>
            {helperName}
          </Text>
        </Pressable>
        <Tag quiet label={t(`help.type.${help.type}`, locale)} />
      </View>

      {/* The helper's two lines, if any — `ink-2` (body copy), not `faint`. This is the row's
          payload and has to outrank the help-type Tag beside the name, whose `quiet` tone is
          `muted-foreground` and therefore sits ABOVE `faint`. Ladder: name > message > type. */}
      {help.message ? (
        <Text className="text-[14px] leading-relaxed text-ink-2">{help.message}</Text>
      ) : null}

      {/* actions by status */}
      {help.status === 'offered' ? (
        <View className="flex-row items-center gap-3">
          <Button
            label={t('help.owner.accept', locale)}
            variant="light"
            disabled={mutating}
            onPress={onAccept}
          />
          <Button
            label={t('help.owner.decline', locale)}
            variant="ghost"
            disabled={mutating}
            onPress={onDecline}
          />
        </View>
      ) : help.status === 'accepted' ? (
        <View className="gap-3">
          <Text className="text-[12px] text-faint">{t('help.state.accepted', locale)}</Text>
          <Button
            label={t('help.owner.confirm', locale)}
            variant="light"
            disabled={mutating}
            onPress={onConfirm}
          />
        </View>
      ) : null}
    </View>
  );
}
