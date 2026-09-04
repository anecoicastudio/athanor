import { useCallback, useState } from 'react';
import * as WebBrowser from 'expo-web-browser';
import * as Linking from 'expo-linking';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { ContributionSessionError, createContributionSession, fundKeys } from '@athanor/api';
import { MIN_CONTRIBUTION_CENTS, feeCoverage, formatEuroAmount } from '@athanor/core';
import { t, type MessageKey } from '@athanor/i18n';
import { Pressable, ScrollView, Text, View } from '@/tw';
import { Button } from '@/components/Button';
import { ModalHeader } from '@/components/ModalHeader';
import { Screen } from '@/components/Screen';
import { DISCLOSURE_BLOCKS } from '@/lib/fund-disclosure';
import { supabase } from '@/lib/supabase';
import { useActiveEdition } from '@/hooks/use-active-edition';
import { useLocale } from '@/hooks/use-locale';

// The server's `{error}` strings are the stable contract (#103 idiom) — the D34 window
// gate in create-contribution-session on one side, this map on the other. A window
// refusal must not read as a payment failure (#222); an unmapped string degrades to
// fund.contribute.error, never crashes. Moved here with the payment launch (#235):
// this screen is now the only place a contribution session is created.
const CONTRIB_ERROR_COPY: Record<string, MessageKey> = {
  'the cycle is closed': 'fund.contribute.cycleClosed',
  'edition not found': 'fund.contribute.cycleClosed',
};

/**
 * Blocking pre-payment disclosure — the sixteen facts in six blocks (FUND-18, #235).
 *
 * Payment is unreachable without this screen by construction: the ONLY call site of
 * `createContributionSession` in the app is the accept CTA below (`fund-disclosure.test.ts`
 * pins it), and annual.tsx can only push here. The CTA is the LAST scroll child on
 * purpose — reaching it means having scrolled past every block. This is a consent
 * position, not a persistent action bar, so it is not a `Screen footer` (#117).
 *
 * Money screen: flat surfaces, no glow (rule #4). Facts render from DISCLOSURE_BLOCKS
 * (`@/lib/fund-disclosure`) — the spec owns block membership, the catalog owns the words.
 */
export default function FundDisclosureScreen() {
  const router = useRouter();
  const qc = useQueryClient();
  const locale = useLocale();

  // The amount was chosen on annual.tsx; an absent/garbled param disables the CTA
  // rather than inventing a fallback amount.
  const { amount } = useLocalSearchParams<{ amount?: string }>();
  const amountCents = Number.parseInt(amount ?? '', 10);
  const validAmount = Number.isFinite(amountCents) && amountCents >= MIN_CONTRIBUTION_CENTS;

  // Cached from annual.tsx in the normal flow; refetched on a direct deep link.
  const editionQuery = useActiveEdition();
  const edition = editionQuery.data ?? null;

  const [contribPhase, setContribPhase] = useState<'idle' | 'opening' | 'canceled' | 'error'>(
    'idle',
  );
  const [contribErrorKey, setContribErrorKey] = useState<MessageKey>('fund.contribute.error');

  // #236 — the optional fee coverage. UNTICKED, always: CRD 2011/83/EU Art. 22 requires
  // express consent for any payment additional to the main obligation and expressly excludes
  // pre-ticked boxes. There is deliberately no «remember my choice» — a remembered tick is a
  // pre-ticked box wearing a different name, and whether Art. 22 even reaches a donation's
  // optional coverage is still counsel's question (#250).
  const [coverFees, setCoverFees] = useState(false);

  // Display only. The server recomputes this from the same formula before it ever reaches
  // Stripe (create-contribution-session/logic.ts), exactly as it re-floors the amount — the
  // screen's job is to show the payer the figure, never to name it.
  const split = validAmount ? feeCoverage(amountCents) : null;

  const onAccept = useCallback(async () => {
    if (!validAmount) return;
    setContribPhase('opening');
    try {
      const { url } = await createContributionSession(supabase, {
        editionId: edition?.id ?? '',
        amountCents,
        coverFees,
      });
      const result = await WebBrowser.openAuthSessionAsync(url, `${'athanor://'}annual`);
      if (result.type === 'success' && result.url) {
        const { queryParams } = Linking.parse(result.url);
        if (queryParams?.contrib === 'success') {
          // Replace, not push: back from the thank-you overlay lands on annual.tsx,
          // the same stack shape the pre-#235 flow had. The ticker moves when the
          // webhook lands (money = webhook cache, rule #6).
          router.replace('/(modal)/contribution-thanks');
          return;
        }
      }
      setContribPhase('canceled');
    } catch (e) {
      const code = e instanceof ContributionSessionError ? e.code : null;
      const copy = code ? CONTRIB_ERROR_COPY[code] : undefined;
      setContribErrorKey(copy ?? 'fund.contribute.error');
      // A window refusal means the cached edition is stale (cycle rolled over or
      // closed) — re-read so annual.tsx flips to its real state instead of arguing.
      if (copy) void qc.invalidateQueries({ queryKey: fundKeys.activeEdition() });
      setContribPhase('error');
    }
  }, [validAmount, amountCents, coverFees, edition?.id, router, qc]);

  return (
    <Screen>
      <ModalHeader title={t('fund.disclose.title', locale)} backLabel={t('common.back', locale)} />

      <ScrollView className="flex-1" contentContainerClassName="gap-6 px-5 pb-12">
        <Text className="text-[14px] leading-5 text-muted-foreground">
          {t('fund.disclose.lead', locale)}
        </Text>

        {/* Six titled blocks, never sixteen flat bullets — wallpaper that looks like
            consent is worse than nothing. Flat card surfaces: this is a money screen,
            nothing here glows. */}
        {DISCLOSURE_BLOCKS.map((block) => (
          <View key={block.title} className="rounded-card border border-hair bg-surface p-5 gap-3">
            <Text className="text-[15px] font-semibold text-foreground">
              {t(block.title, locale)}
            </Text>
            {block.facts.map((fact) => (
              <Text key={fact} className="text-[14px] leading-5 text-foreground">
                {fact === 'fund.disclose.retains.percent'
                  ? // The declared per-cycle figure itself (#232, D15) — `split_pct` is NOT NULL
                    // and frozen at open, so the number shown is the number that governs. The
                    // em-dash only appears during a direct-deep-link refetch, when the CTA is
                    // disabled anyway.
                    t(fact, locale, { percent: edition ? String(edition.split_pct) : '—' })
                  : t(fact, locale)}
              </Text>
            ))}
          </View>
        ))}

        {/* The optional fee coverage (#236 / FUND-51) — a CHOICE, not a seventeenth fact, so
            it sits after the six blocks and immediately above the CTA: the last thing read
            before consent, and adjacent to the button whose price it changes. Never a
            surcharge (PSD2 Art. 62(4)) and never pre-ticked (CRD Art. 22). Flat surface, no
            glow — a money screen, and nothing has happened yet (rule #4). */}
        {split ? (
          <View className="rounded-card border border-hair bg-surface p-5 gap-3">
            <Pressable
              accessibilityRole="checkbox"
              accessibilityState={{ checked: coverFees }}
              accessibilityLabel={t('fund.disclose.coverage.label', locale, {
                fee: formatEuroAmount(split.coverageCents, locale),
              })}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              className="min-h-[44px] flex-row items-center gap-3"
              onPress={() => setCoverFees((v) => !v)}
            >
              {/* ✓/○ — the app's paired-glyph vocabulary (MilestoneRow/BenefitRow): SHAPE
                  carries the state, so the tick is legible without relying on colour. */}
              <Text className={coverFees ? 'text-base text-aura' : 'text-base text-faint'}>
                {coverFees ? '✓' : '○'}
              </Text>
              <Text className="flex-1 text-[14px] leading-5 text-foreground">
                {t('fund.disclose.coverage.label', locale, {
                  fee: formatEuroAmount(split.coverageCents, locale),
                })}
              </Text>
            </Pressable>

            {/* The arithmetic, only while the box is ticked — an unticked box charges the
                gift and nothing else, and showing a total nobody is about to be charged
                would be the same lie in the other direction. */}
            {coverFees ? (
              <Text className="text-[13px] leading-5 text-foreground">
                {t('fund.disclose.coverage.total', locale, {
                  amt: formatEuroAmount(split.giftCents, locale),
                  fee: formatEuroAmount(split.coverageCents, locale),
                  total: formatEuroAmount(split.chargedCents, locale),
                })}
              </Text>
            ) : null}

            <Text className="text-[12px] leading-4 text-muted-foreground">
              {t('fund.disclose.coverage.optional', locale)}
            </Text>
            <Text className="text-[12px] leading-4 text-muted-foreground">
              {t('fund.disclose.coverage.notReturned', locale)}
            </Text>
          </View>
        ) : null}

        {/* Accept + pay — the sole gateway to createContributionSession. Deliberately the
            last scroll child (consent position), after every block. */}
        <View className="gap-3">
          <Button
            label={
              contribPhase === 'opening'
                ? t('fund.contribute.opening', locale)
                : t('fund.disclose.cta', locale, {
                    amt: String(Math.floor(amountCents / 100)),
                  })
            }
            onPress={() => void onAccept()}
            variant="light"
            disabled={contribPhase === 'opening' || !validAmount || !edition}
            // Flat cyan CTA — no glow (rule #4)
          />
          {contribPhase === 'canceled' ? (
            <Text className="text-[12px] text-muted-foreground">
              {t('fund.contribute.canceled', locale)}
            </Text>
          ) : null}
          {contribPhase === 'error' ? (
            <Text className="text-[12px] text-error">{t(contribErrorKey, locale)}</Text>
          ) : null}
          <Text className="text-[12px] text-muted-foreground">
            {t('fund.contribute.zeroAura', locale)}
          </Text>
        </View>
      </ScrollView>
    </Screen>
  );
}
