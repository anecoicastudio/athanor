import { t } from '@athanor/i18n';
import { STAR_KEYS, type AuraSnapshot, type Locale } from '@athanor/schemas';
import { Row } from '@/components/Row';
import { AURA_UNKNOWN } from '@/lib/aura-display';

/**
 * «Le tue stelle» row (PRD 01-m1-identity §3.2, block 7). M1 owns the frame; the lit flags
 * come read-only from the Aura snapshot (zero for new users until the M6 score-engine fills
 * them — rule #1, never client-written). Tapping the row hands off to Profilo where the full
 * Six Stars live.
 *
 * One `Row` in the group Home ends on (#921, 2026-10-05), as the prototype draws it: the title,
 * and at the right one ✦ per lit star with «N di 6 accese ›» in grey. Before that it was a
 * block of its own with the member's Aura numeral, six glyphs lit or unlit, and the count. The
 * numeral is on Profilo and the Aura screen; a lit star is not cyan (DESIGN §2.3). At the
 * accessibility text sizes `Row` puts the value under the title, so the count no longer runs
 * past the right edge there.
 *
 * `snapshot === null` means we could not read it (loading, disabled, or failed) — the row
 * renders «—» rather than a confident zero, which on an earned-only reputation would read as
 * «hai guadagnato niente» (issue #16).
 */
export function StarsMiniRow({
  snapshot,
  locale,
  onPress,
}: {
  snapshot: AuraSnapshot | null;
  locale: Locale;
  onPress: () => void;
}) {
  const lit = snapshot ? STAR_KEYS.filter((key) => snapshot.stars[key]).length : 0;

  return (
    /*
      The label carries the score and the lit count (#635): the row is one button, so what it
      shows at the right is announced by nothing else.

      Two arms rather than a «—» in the sentence: the unknown snapshot is the row DECLINING to
      answer (see the docblock), and «Aura non disponibile» says that, where "{score} Aura" with
      score «—» would be read aloud as "dash Aura". `total` is `STAR_KEYS.length` and not a
      literal 6, so the sentence follows the star set rather than restating it — `home.stars.count`
      still hardcodes its own, and that one is visible copy this issue does not touch.

      `home.stars.count` ends on its own `›`, so `Row` draws its chevron only for the unknown arm.
    */
    <Row
      title={t('home.stars.title', locale)}
      value={
        snapshot ? `${'✦ '.repeat(lit)}${t('home.stars.count', locale, { lit })}` : AURA_UNKNOWN
      }
      showChevron={!snapshot}
      onPress={onPress}
      accessibilityLabel={
        snapshot
          ? t('home.stars.a11y', locale, {
              score: snapshot.score,
              lit,
              total: STAR_KEYS.length,
            })
          : t('home.stars.a11yUnknown', locale)
      }
    />
  );
}
