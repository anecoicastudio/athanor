import { useQuery } from '@tanstack/react-query';
import { auraKeys } from '@athanor/api';
import { pickNextStar } from '@athanor/core';
import { t, type MessageKey } from '@athanor/i18n';
import { ScrollView, Text, View } from '@/tw';
import { HeaderClose, ModalHeader } from '@/components/ModalHeader';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { EmptyState } from '@/components/EmptyState';
import { Row } from '@/components/Row';
import { RowGroup } from '@/components/RowGroup';
import { SectionLabel } from '@/components/SectionLabel';
import { ShimmerBar } from '@/components/ShimmerBar';
import { useAuth } from '@/lib/auth-context';
import { useLocale } from '@/hooks/use-locale';
import { useStars } from '@/hooks/use-stars';
import { fetchWeekRecap } from '@/lib/week-recap';
import { weekRecapIsEmpty } from '@/lib/week-slot';
import { MODAL_A11Y } from '@/lib/a11y';
import { useGuardedBack } from '@/lib/modal-exit';
import { Screen } from '@/components/Screen';

/**
 * Week recap sheet (M6 §3.4).
 * Derives display aggregation from owner's ledger via core summarizeWeek (rule #1: no score write).
 * Engine is DORMANT → getAuraEventsSince returns [] → recap all-zeros → empty-week state.
 */
export default function RecapScreen() {
  const leave = useGuardedBack();
  const { session } = useAuth();
  const locale = useLocale();
  const me = session?.user.id ?? '';

  // Week recap: shared queryFn (lib/week-recap) — one fetch shape per auraKeys.recap key.
  const recapQuery = useQuery({
    queryKey: auraKeys.recap(me),
    queryFn: () => fetchWeekRecap(me),
    enabled: !!me,
  });

  // Stars: for «Prossima stella» block via pickNextStar.
  const starsQuery = useStars(me);

  const recap = recapQuery.data;
  // `?? []` is safe HERE and nowhere else (issue #16): the only consumer is pickNextStar, which
  // returns null for an empty array, so a failed read hides the «Prossima stella» block instead
  // of claiming zero progress. No star is rendered on this screen. If one ever is, switch to
  // `starsOrNull` — the coalesce becomes a false «none earned» the moment a glyph depends on it.
  const stars = starsQuery.data ?? [];
  const nextStar = pickNextStar(stars);

  const isLoading = recapQuery.isLoading;
  const isError = recapQuery.isError;
  // Shared with Home's WeekSlot — one definition of a quiet week. Inlining the old two-field test
  // here while Home widened it would manufacture a disagreement: a zero-point `milestone_help`
  // would show a WeekCard on Home that opens this sheet saying «Una settimana tranquilla».
  const isEmptyWeek = recap != null && weekRecapIsEmpty(recap);

  // «Prossima stella» {gap}: localized via recap.next.gap to avoid Italian "a" leaking into EN.
  const gapStr = (() => {
    if (!nextStar) return '';
    const remaining = nextStar.total - nextStar.done;
    const unit = t(`star.unit.${nextStar.unit}` as MessageKey, locale);
    return t('recap.next.gap' as MessageKey, locale, { remaining, unit });
  })();

  const starName = nextStar ? t(`star.${nextStar.starId}` as MessageKey, locale) : '';

  return (
    <Screen {...MODAL_A11Y}>
      <ModalHeader
        leading="none"
        title={t('recap.title' as MessageKey, locale)}
        right={<HeaderClose label={t('common.back' as MessageKey, locale)} onPress={leave} />}
      />

      {/* Blocks 26 apart on the 20 gutter (DESIGN §6); the grey line sits under the header. */}
      <ScrollView contentContainerClassName="gap-[26px] px-5 pb-12">
        <Text className="type-small text-muted-foreground">
          {t('recap.sub' as MessageKey, locale)}
        </Text>

        {isError ? (
          <View className="items-center gap-4">
            <EmptyState>{t('aura.error' as MessageKey, locale)}</EmptyState>
            <Button
              label={t('common.retry' as MessageKey, locale)}
              variant="ghost"
              onPress={() => void recapQuery.refetch()}
            />
          </View>
        ) : isLoading ? (
          <View className="gap-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <ShimmerBar key={i} />
            ))}
          </View>
        ) : isEmptyWeek ? (
          <EmptyState>{t('recap.emptyWeek' as MessageKey, locale)}</EmptyState>
        ) : (
          // The week's three figures, one group of rows (DESIGN §8.12). Foreground: a week's
          // gain is not the member's Aura numeral, so nothing here is cyan (Marco, 2026-10-07).
          <RowGroup>
            <Figure
              label={t('recap.metric.aura' as MessageKey, locale)}
              value={recap?.auraWeek ?? 0}
              signed
            />
            <Figure
              label={t('recap.metric.contributi' as MessageKey, locale)}
              value={recap?.contributi ?? 0}
            />
            <Figure
              label={t('recap.metric.dreams' as MessageKey, locale)}
              value={recap?.sogniAiutati ?? 0}
            />
          </RowGroup>
        )}

        {/* «Prossima stella», the screen's one bordered card — hidden when nextStar is null */}
        {!isLoading && !isError && nextStar != null ? (
          <Card>
            <SectionLabel>{t('recap.next.label' as MessageKey, locale)}</SectionLabel>
            {/* «{star} — {gap}» IS the block's title and «Prossima stella» is the generic label
                over it, so the title takes the header. The screen's own h1 sits on ModalHeader —
                a Card is a different block, so this is not two for one. */}
            <Text accessibilityRole="header" className="type-h2 text-foreground">
              {t('recap.next.title' as MessageKey, locale, { star: starName, gap: gapStr })}
            </Text>
            <Text className="type-small text-muted-foreground">
              {t('recap.next.body' as MessageKey, locale)}
            </Text>
          </Card>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

/**
 * One figure of the week: its name at the left, the number at the right in the middle numeral
 * style, and one spoken line for both (an inert `Row` is not announced as one thing by itself).
 * Only the Aura figure is `signed`: it is a gain, the other two are counts.
 */
function Figure({
  label,
  value,
  signed = false,
}: {
  label: string;
  value: number;
  signed?: boolean;
}) {
  const shown = `${signed && value > 0 ? '+' : ''}${value}`;
  return (
    <View accessible accessibilityLabel={`${label}, ${shown}`}>
      <Row
        title={label}
        trailing={
          <Text className="type-num-m text-foreground" style={{ fontVariant: ['tabular-nums'] }}>
            {shown}
          </Text>
        }
      />
    </View>
  );
}
