import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { auraKeys, getAuraScoreFull } from '@athanor/api';
import { breakdownRows, DECAY } from '@athanor/core';
import { galleria } from '@athanor/config';
import { t, type MessageKey } from '@athanor/i18n';
import { ScrollView, Text, View } from '@/tw';
import { AuraSourceRow } from '@/components/aura/AuraSourceRow';
import { RuleRow } from '@/components/aura/RuleRow';
import { AuraValue } from '@/components/AuraValue';
import { EmptyState } from '@/components/EmptyState';
import { ScalesGlyph } from '@/components/glyphs';
import { ShimmerBar } from '@/components/ShimmerBar';
import { ModalHeader } from '@/components/ModalHeader';
import { Row } from '@/components/Row';
import { RowGroup } from '@/components/RowGroup';
import { SectionLabel } from '@/components/SectionLabel';
import { AURA_UNKNOWN } from '@/lib/aura-display';
import { useAuth } from '@/lib/auth-context';
import { useAuraRealtime } from '@/hooks/use-aura-realtime';
import { useNow } from '@/hooks/use-now';
import { useLocale } from '@/hooks/use-locale';
import { supabase } from '@/lib/supabase';
import { Screen } from '@/components/Screen';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Aura breakdown modal (M6 §3.1; Galleria, 2026-10-09, #921).
 * The member's own numeral alone over its grey line, the six sources as bare blocks, then one
 * group of rows: the three protection rules and the link to the ledger. A decay caption stands
 * under the group once the member has been idle longer than the engine's window.
 * No card and no frame: nothing here stands for a tier. The one cyan is the numeral, which is
 * always the signed-in member's (`me`), whoever's profile linked here.
 * Read-only. No Aura writes (rule #1). Cache key: auraKeys.detail (not .score) —
 * different return shape from the snapshot used on Profilo/Home.
 */
export default function AuraScreen() {
  const router = useRouter();
  const { session } = useAuth();
  const locale = useLocale();
  const me = session?.user.id ?? '';

  // Realtime wiring: when score pushes arrive, auraKeys.all is invalidated so
  // the hero AuraValue re-tweens on the refetched value (§3.1 realtime-bump).
  // No callback needed — just score + ledger + stars cache invalidation.
  useAuraRealtime(me);

  const query = useQuery({
    queryKey: auraKeys.detail(me),
    queryFn: () => getAuraScoreFull(supabase, me),
    enabled: !!me,
  });

  const full = query.data;
  const score = full?.score ?? 0;

  // Decay caption: only once the member has been idle longer than the engine's own window
  // (`DECAY.IDLE_DAYS_BEFORE` in `packages/core/src/score/weights.ts`, rule 10), counted from
  // lastQualifyingActionAt.
  const now = useNow();
  let idleDays: number | null = null;
  if (full?.lastQualifyingActionAt) {
    const last = new Date(full.lastQualifyingActionAt).getTime();
    const elapsed = Math.floor((now - last) / MS_PER_DAY);
    if (elapsed > DECAY.IDLE_DAYS_BEFORE) idleDays = elapsed;
  }

  return (
    <Screen>
      {/* Header */}
      <ModalHeader title={t('aura.title', locale)} backLabel={t('common.back', locale)} />

      <ScrollView contentContainerClassName="gap-[26px] px-5 pb-12">
        {/* Hero */}
        <View className="items-center gap-2 py-2">
          {/* Gate on `full === undefined`, not `isLoading`, and match the sources shimmer below.
              `isLoading` is `isPending && isFetching` in TanStack v5, so a DISABLED query — which
              this is until `me` resolves, since the session hydrates async — reports
              `isLoading: false` with no data and would fall straight through to a confident 0.
              `isError` is folded in because the EmptyState below already says the read failed,
              and a number next to that message contradicts it.
              The placeholder is grey, not cyan: the cyan is the member's own Aura numeral
              (DESIGN §2.3), and a placeholder is not a number. Same style as `AuraValue`. */}
          {full === undefined || query.isError ? (
            <Text
              accessibilityLabel={t('aura.unknown', locale)}
              className="type-num text-muted-foreground"
            >
              {AURA_UNKNOWN}
            </Text>
          ) : (
            <AuraValue value={score} flashOnIncrease />
          )}
          <Text className="text-center type-small text-muted-foreground">
            {t('aura.tagline', locale)}
          </Text>
        </View>

        {query.isError ? (
          <EmptyState
            line="body"
            action={{ label: t('common.retry', locale), onPress: () => void query.refetch() }}
          >
            {t('aura.error', locale)}
          </EmptyState>
        ) : (
          <>
            {/* Sources: bare blocks on the stage, 12 apart */}
            <View className="gap-2">
              <SectionLabel heading>{t('aura.sources.title', locale)}</SectionLabel>
              <View className="gap-3">
                {full === undefined
                  ? Array.from({ length: 6 }).map((_, i) => <ShimmerBar key={i} />)
                  : breakdownRows(full.breakdown).map((row) => (
                      <AuraSourceRow
                        key={row.key}
                        label={t(`aura.source.${row.key}` as MessageKey, locale)}
                        value={row.value}
                        width={row.width}
                      />
                    ))}
              </View>
            </View>

            {/* Protection rules, and the way to the ledger, as one group */}
            <RowGroup label={t('aura.protection.title', locale)}>
              <RuleRow
                glyph="◎"
                title={t('aura.rule.verified.title', locale)}
                desc={t('aura.rule.verified.desc', locale)}
              />
              {/* weighted — the set's `scales`, drawn (#753: the U+2696 character it
                  replaced is emoji-capable, and fell back to the emoji font) */}
              <RuleRow
                glyph={<ScalesGlyph size={20} color={galleria.foreground} />}
                title={t('aura.rule.weighted.title', locale)}
                desc={t('aura.rule.weighted.desc', locale)}
              />
              <RuleRow
                glyph="◑"
                title={t('aura.rule.decay.title', locale)}
                desc={t('aura.rule.decay.desc', locale)}
              />
              <Row
                title={t('aura.ledger.cta', locale)}
                showChevron={false}
                onPress={() => router.push('/aura/ledger')}
              />
            </RowGroup>

            {/* Decay caption — only past the engine's idle window */}
            {idleDays !== null ? (
              <Text className="type-small text-muted-foreground">
                {t('aura.decay.caption', locale, { days: idleDays })}
              </Text>
            ) : null}
          </>
        )}
      </ScrollView>
    </Screen>
  );
}
