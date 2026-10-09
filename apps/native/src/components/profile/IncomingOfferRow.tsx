import { useRouter } from 'expo-router';
import { memberLabel } from '@athanor/core';
import { t } from '@athanor/i18n';
import type { Help, Locale } from '@athanor/schemas';
import { Pressable, Text, View, cn } from '@/tw';
import { Avatar } from '@/components/Avatar';
import { Button } from '@/components/Button';
import { ButtonRow } from '@/components/ButtonRow';
import { PRESS_DIM } from '@/lib/press';
import type { HelperIdentity } from '@/hooks/use-own-dream';

/**
 * One «Aiuti in arrivo» block on the owner's Profilo (frontend `02` §3.4D), a child of that
 * `RowGroup` (the prototype's `.rows > .row.col`: 14 above and below, 10 between its lines).
 * Who offered help on a tappa, what kind and their words, then accept / decline
 * (status='offered') as two small pills, or confirm-done (status='accepted'). Owner-confirm
 * lives here on the accepted offer (simpler than threading it into the tappa row). Confirm-done
 * is the +40/+10 domain event — but this row writes NO Aura (rule #1); the caller's
 * confirmHelpComplete only touches milestone_helps + dream_milestones.
 *
 * The identity line is one button to the helper's profile (#356). It holds the name, the kind
 * of help and the message, so its label says all three: a labelled button is believed to hide
 * the text inside it from a screen reader (unverified: no screen reader was run on this row),
 * and the message is the block's payload.
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
  const kind = t(`help.type.${help.type}`, locale);
  return (
    <View className={cn('gap-[10px] py-[14px]', mutating && 'opacity-50')}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={[
          t('connection.a11y.open', locale, { name: helperName }),
          kind,
          help.message,
        ]
          .filter(Boolean)
          .join(', ')}
        className={cn('flex-row items-center gap-3', PRESS_DIM)}
        onPress={() => router.push(`/(modal)/user/${help.helper_id}`)}
      >
        <Avatar
          decorative
          handle={helper?.handle ?? null}
          displayName={helper?.displayName ?? null}
          avatarPath={helper?.avatarPath ?? null}
          size={44}
        />
        <View className="flex-1 gap-0.5">
          <Text className="type-body font-medium text-foreground" numberOfLines={1}>
            {helperName}
          </Text>
          {/* The kind of help, then the helper's own words: one grey line, never clamped. */}
          <Text className="type-small text-muted-foreground">
            {[kind, help.message].filter(Boolean).join(' · ')}
          </Text>
        </View>
      </Pressable>

      {/* actions by status */}
      {help.status === 'offered' ? (
        <ButtonRow>
          <Button
            size="sm"
            label={t('help.owner.accept', locale)}
            disabled={mutating}
            onPress={onAccept}
          />
          <Button
            variant="outline"
            size="sm"
            label={t('help.owner.decline', locale)}
            disabled={mutating}
            onPress={onDecline}
          />
        </ButtonRow>
      ) : help.status === 'accepted' ? (
        <>
          <Text className="type-small text-muted-foreground">
            {t('help.state.accepted', locale)}
          </Text>
          <ButtonRow>
            <Button
              size="sm"
              label={t('help.owner.confirm', locale)}
              disabled={mutating}
              onPress={onConfirm}
            />
          </ButtonRow>
        </>
      ) : null}
    </View>
  );
}
