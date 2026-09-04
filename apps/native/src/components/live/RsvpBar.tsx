import { View, Text } from '@/tw';
import { Button } from '@/components/Button';
import { t } from '@athanor/i18n';

/**
 * Free-event RSVP action bar (frontend §3.3). Paid events do NOT use this — the detail
 * screen keeps the «Presto» stub (tickets-qr slice). Optimistic state + the upsert
 * mutation live in the parent; this is presentation. NO client Aura write (rule #1).
 *
 *  - going=false → «Partecipo» (Button light)
 *  - going=true  → «✓ Parteciperai» (Button ghost) + «Calendario» (Button ghost)
 *  - soldOut (capacity reached AND not going) → «Tutto esaurito» (disabled)
 *
 * `permissionNotice` is the calendar refusal (#531), and it is deliberately NOT the
 * `confirmation` line: that one auto-dismisses after 2.5s in the parent, which is right for
 * «Aggiunto al calendario» and wrong for a message whose whole purpose is to offer a route
 * out. It also draws in `text-faint` rather than the confirmation's cyan — a refusal is not
 * moment-grade (rule #4).
 */
export function RsvpBar({
  going,
  soldOut,
  pending,
  calendarPending,
  confirmation,
  permissionNotice = null,
  onToggle,
  onAddToCalendar,
  onOpenSettings = null,
  locale,
}: {
  going: boolean;
  soldOut: boolean;
  pending: boolean;
  /** «Calendario» in flight (#548) — Button `loading` implies disabled, so a double-tap cannot queue a second write. */
  calendarPending: boolean;
  confirmation: string | null;
  /** Why «Calendario» did nothing. Stays until the member acts. */
  permissionNotice?: string | null;
  onToggle: () => void;
  onAddToCalendar: () => void;
  /** Set only when the grant cannot be re-prompted — Settings is then the only way back. */
  onOpenSettings?: (() => void) | null;
  locale: 'it' | 'en';
}) {
  return (
    <View className="gap-2 rounded-card border border-hair bg-raise p-4">
      {soldOut && !going ? (
        <Button label={t('event.soldOut', locale)} variant="ghost" disabled onPress={() => {}} />
      ) : going ? (
        <View className="flex-row gap-2">
          <View className="flex-1">
            <Button
              label={t('event.rsvp.confirmed', locale)}
              variant="ghost"
              disabled={pending}
              onPress={onToggle}
            />
          </View>
          <Button
            label={t('event.rsvp.calendar', locale)}
            variant="ghost"
            loading={calendarPending}
            onPress={onAddToCalendar}
          />
        </View>
      ) : (
        <Button
          label={t('event.rsvp.going', locale)}
          variant="light"
          disabled={pending}
          onPress={onToggle}
        />
      )}
      {confirmation ? (
        <Text className="text-center text-[13px] text-aura">{confirmation}</Text>
      ) : null}
      {permissionNotice ? (
        <View className="gap-2">
          <Text className="text-center text-[13px] text-faint">{permissionNotice}</Text>
          {onOpenSettings ? (
            <Button
              label={t('permission.openSettings', locale)}
              variant="ghost"
              onPress={onOpenSettings}
            />
          ) : null}
        </View>
      ) : null}
    </View>
  );
}
