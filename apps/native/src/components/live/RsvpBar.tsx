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
 */
export function RsvpBar({
  going,
  soldOut,
  pending,
  confirmation,
  onToggle,
  onAddToCalendar,
  locale,
}: {
  going: boolean;
  soldOut: boolean;
  pending: boolean;
  confirmation: string | null;
  onToggle: () => void;
  onAddToCalendar: () => void;
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
    </View>
  );
}
