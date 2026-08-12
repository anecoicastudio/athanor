import type { ReactNode } from 'react';
import { ActivityIndicator } from 'react-native';
import { semantic } from '@athanor/config';
import { t } from '@athanor/i18n';
import type { Locale } from '@athanor/schemas';
import { Text, View, cn } from '@/tw';
import { Button } from '@/components/Button';
import { EmptyState } from '@/components/EmptyState';
import type { ListState as State } from '@/lib/list-state';

type Props = {
  /**
   * From `listState({ status, fetchStatus, isEmpty })`. A screen that already branched on
   * `query.isError` upstream may pass `'error'` directly — it has made the same decision, it
   * just made it earlier.
   */
  state: State;
  locale: Locale;
  /** What failed, in this screen's own words: «Non siamo riusciti a caricare i messaggi.» */
  errorLabel: string;
  /** What is genuinely absent. Omit on a surface whose empty case is drawn elsewhere. */
  emptyLabel?: string;
  /** Optional second line under `emptyLabel` — the `*.emptyBody` keys several screens have. */
  emptyBody?: string;
  /** `query.refetch()`. Required: an error state the member cannot leave is half a fix. */
  onRetry: () => void;
  /** Replaces the default spinner — a shimmer, a ghost card, or `null` for a silent load. */
  loading?: ReactNode;
  /**
   * REPLACES the default padding, never appends to it. Two Tailwind paddings on one element
   * resolve by stylesheet source order rather than by string order, so `cn('pt-24', 'pt-20')`
   * silently keeps whichever the sheet declares last. Structural classes (`items-center`,
   * the error arm's `gap-4`) are always applied and are not overridable.
   */
  className?: string;
};

/** What the ~10 screens migrating onto this already spell by hand. */
const DEFAULT_PADDING = 'px-8 pt-24';

/**
 * The states a list-backed surface can be in, in one place (issue #111).
 *
 * Every screen used to spell this as one `!isLoading ? <EmptyState/> : null`, so a thrown read
 * rendered the empty copy — «Non hai bloccato nessuno» for a block list that failed to load,
 * «Presto qui» for a Circle member's analytics, «Non ha ancora scritto il suo sogno» about a
 * person whose dream simply did not arrive. Each of those is a false claim, and on `blocked`
 * it is a false claim about someone's safety.
 *
 * Owns the *content* of the slot, not the slot: the caller keeps its own frame, because these
 * live in a `ListEmptyComponent`, in a full-screen early return, and inline in a `ScrollView`,
 * and the paddings differ. Same division `MediaFrame` draws for the media surfaces (#135).
 *
 * The retry is `Button variant="ghost"`, which is what `payments`, `my-events`, `aura`,
 * `aura/ledger` and `recap` already use. Deliberately NOT the `border-aura-line bg-aura-soft`
 * pill the other error branches hand-rolled: rule #4 reserves that framed cyan surface for
 * moment-grade events, and a failed fetch is the opposite of a moment.
 *
 * `idle` and `ready` render nothing. `idle` is the disabled query — a screen waiting on a
 * hydrating session says nothing rather than asserting emptiness — and `ready` means the
 * caller is drawing its rows.
 *
 * ── WHICH SURFACES BELONG HERE ────────────────────────────────────────────────────────────
 *
 * Absence sorts into two treatments, and this component is only the first:
 *
 * - **Named** (this component) — absence is a claim about the person, so say which absence it
 *   is and offer a way out. A false «you have nothing» is the harm #111 exists for. Every
 *   list, every detail screen, anything reporting the member's own Aura.
 * - **Collapse** — absence asserts nothing, so the slot vanishes and the destination screen
 *   owns the copy and the retry. That treatment is a bare `return null` at the caller, not a
 *   prop here, because what has to disappear is the whole section — its eyebrow and its link
 *   included — and a child cannot unmount its parent. `FavorNudgeCard.tsx:19-30`,
 *   `MomentiCard.tsx:20-27` and `TodaySection.tsx` are the three, and each carries the
 *   reasoning in its own docblock.
 *
 * Named is the default: reach for collapse only when a member losing the block entirely costs
 * them nothing, and say so in the caller's docblock.
 */
export function ListState({
  state,
  locale,
  errorLabel,
  emptyLabel,
  emptyBody,
  onRetry,
  loading,
  className,
}: Props) {
  if (state === 'idle' || state === 'ready') return null;

  const padding = className ?? DEFAULT_PADDING;

  if (state === 'loading') {
    return loading !== undefined ? (
      <>{loading}</>
    ) : (
      <View className={cn('items-center', padding)}>
        <ActivityIndicator color={semantic.faint} />
      </View>
    );
  }

  if (state === 'error') {
    return (
      <View className={cn('items-center gap-4', padding)}>
        <EmptyState>{errorLabel}</EmptyState>
        <Button label={t('common.retry', locale)} variant="ghost" onPress={onRetry} />
      </View>
    );
  }

  return (
    <View className={cn('items-center', padding)}>
      {emptyLabel != null ? <EmptyState>{emptyLabel}</EmptyState> : null}
      {emptyBody != null ? (
        <Text className="mt-1 text-center text-[13px] text-faint">{emptyBody}</Text>
      ) : null}
    </View>
  );
}
