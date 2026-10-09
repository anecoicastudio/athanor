import { useState } from 'react';
import { Alert, useWindowDimensions } from 'react-native';
import { t } from '@athanor/i18n';
import type { Locale, MilestoneStatus } from '@athanor/schemas';
import { galleria } from '@athanor/config';
import { Pressable, Text, View, cn } from '@/tw';
import { MoreIcon } from '@/components/glyphs';
import { isHelpableStatus, type HelpState } from '@/lib/help-picker';
import { PRESS_DIM } from '@/lib/press';
import { stacksTrailing } from '@/lib/type-scale';

const STATE_KEY = {
  open: 'milestone.state.open',
  in_progress: 'milestone.state.inProgress',
  done: 'milestone.state.done',
} as const;

const HELP_LABEL_KEY = {
  offered: 'help.state.offered',
  accepted: 'help.state.accepted',
  completed: 'help.state.completed',
  // A declined offer is terminal for this helper: the (milestone_id, helper_id) unique index
  // has no deleted_at partial, so «Aiuta» could never succeed a second time.
  declined: 'help.state.declined',
} as const;

/**
 * One tappa row (frontend `02` §3.1/§4), a child of the «Le tappe del sogno» `RowGroup`:
 * leading glyph + the need + trailing state text. Owner mode (handlers present) adds the drawn
 * `more` → «Segna come fatta» / «Elimina». Read mode (no handlers) renders glyph + name + state
 * only. Never writes Aura (rule #1). Helper mode (someone else's dream): pass `helpState` for
 * the trailing «Aiuta» / help-state affordance (frontend `02` §3.4C). Helper rows aren't
 * editable — the menu control is never shown when `helpState` is set.
 *
 * It has the grouped row's geometry (at least 60, 8 above and below, 12 between its cells,
 * name in body 17/500, state in small grey) and is NOT the shared `Row` (Marco, 2026-10-05):
 * `Row` has no place for a menu that opens under the row, and none for a row that is one button
 * with a pill shape inside it.
 *
 * In helper mode with an offer still to make, THE WHOLE ROW IS THE BUTTON (#660). It used to
 * be the trailing «Aiuta» alone, next to a `○` that reads exactly like a selection control — a
 * tester kept pressing the left side, which did nothing. So the row is one accessible button,
 * the shape of `Row` and §8.13's «rows are single accessible buttons» (the `○` honestly
 * participates instead of lying), and «Aiuta» is drawn as the small outline pill.
 *
 * That pill is a `View`, never a nested `Pressable`: source-audit §21 forbids one inside
 * another (an accessible ancestor is atomic to VoiceOver) and its register is empty by
 * design. The row's own label carries the name and the state, because an accessible ancestor
 * masks the children that render them.
 *
 * A done tappa is a foreground ✓ and the word «fatto» (cyan ✓, grey struck-through name until
 * 2026-10-05): the state is in the glyph and the word, as on a star's row.
 */
export function MilestoneRow({
  name,
  status,
  locale,
  mutating = false,
  onMarkDone,
  onDelete,
  helpState,
  onHelp,
}: {
  name: string;
  status: MilestoneStatus;
  locale: Locale;
  mutating?: boolean;
  onMarkDone?: () => void;
  onDelete?: () => void;
  helpState?: HelpState;
  onHelp?: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const done = status === 'done';
  // Helper rows aren't editable: never show the owner kebab when in help mode.
  const isOwner = Boolean(onMarkDone || onDelete) && !helpState;
  // `isHelpableStatus` and not a bare `!done`: Person Detail derives `helpState` from the
  // viewer's prior offers alone and defaults to 'available', so a FINISHED tappa arrived here
  // carrying «Aiuta» — beside its own ✓, and absent from the picker the CTA opens, which
  // filters on the very same rule (#660, *Beyond the issue*).
  const offerable = helpState === 'available' && isHelpableStatus(status) && Boolean(onHelp);
  const stateLabel = t(STATE_KEY[status], locale);
  // At the accessibility sizes the state label and the «Aiuta» chip move under the tappa's
  // name (#847): beside both, the `flex-1` name was left narrower than one long word and broke
  // it mid-word («actuall / y»). A tappa is a sentence, so it keeps every line — it just gets
  // the row's width.
  const stacked = stacksTrailing(useWindowDimensions().fontScale);

  const confirmDelete = () => {
    setMenuOpen(false);
    if (!onDelete) return;
    Alert.alert(t('milestone.delete.confirm', locale), undefined, [
      { text: t('common.cancel', locale), style: 'cancel' },
      { text: t('milestone.delete', locale), style: 'destructive', onPress: onDelete },
    ]);
  };

  const nameText = (
    <Text className={cn('type-body font-medium text-foreground', !stacked && 'flex-1')}>
      {name}
    </Text>
  );
  const stateText = <Text className="type-small text-muted-foreground">{stateLabel}</Text>;
  // «Aiuta», or what became of the viewer's offer. The pill is the small outline pill as a
  // shape (see the docblock): the row is the button.
  const helpCell = (
    <>
      {offerable ? (
        <View className="min-h-[44px] justify-center rounded-full border border-muted-foreground px-4">
          <Text className="text-[14px] font-semibold text-foreground">{t('help.cta', locale)}</Text>
        </View>
      ) : helpState && helpState !== 'available' ? (
        <Text className="type-small text-muted-foreground">
          {t(HELP_LABEL_KEY[helpState], locale)}
        </Text>
      ) : null}
    </>
  );

  // The cells every arm shares. It holds NO Pressable, deliberately: source-audit §21 walks tag
  // depth over the file text and cannot see through a const, so a control hoisted in here would
  // nest under the wrapper below at runtime with nothing going red.
  // The owner's menu control therefore
  // sits in the arm that renders it — which is also honest, since `isOwner` requires no
  // `helpState` and can never coexist with `offerable`.
  const rowContent = (
    <>
      {/* leading glyph: ✓ done (foreground), ○ open (grey) */}
      <Text
        className={cn('type-body', done ? 'text-foreground' : 'text-muted-foreground')}
        // Silent on the offerable arm: the row is the button there and its own label already
        // says which tappa and in what state (#635). A labelled ancestor is reported to
        // override its children rather than concatenate them, which would make this belt and
        // braces — but no device is reachable here to confirm that, so the glyph does not
        // rely on it. The children of `Row` carry no labels either.
        accessibilityLabel={
          offerable ? undefined : t(done ? 'milestone.a11y.done' : 'milestone.a11y.open', locale)
        }
      >
        {done ? '✓' : '○'}
      </Text>
      {/* Three layouts, one order: name, state, then «Aiuta» or the offer's state.
          - at the accessibility sizes everything goes under the name (#847: beside both, the
            name was left narrower than one long word and broke it mid-word);
          - with «Aiuta» in the row the state is the name's second line, as a `Row`'s is: beside
            a state word AND the pill the name had 129 of 303pt on an iPhone SE and took three
            lines (simulator, 2026-10-05);
          - otherwise the state stands on the right. */}
      {stacked ? (
        <View className="flex-1 gap-2">
          {nameText}
          <View className="flex-row flex-wrap items-center gap-3">
            {stateText}
            {helpCell}
          </View>
        </View>
      ) : offerable ? (
        <>
          <View className="flex-1 gap-0.5">
            <Text className="type-body font-medium text-foreground">{name}</Text>
            {stateText}
          </View>
          {helpCell}
        </>
      ) : (
        <>
          {nameText}
          {stateText}
          {helpCell}
        </>
      )}
    </>
  );

  const shape = cn('min-h-15 flex-row gap-3 py-2', stacked ? 'items-start' : 'items-center');
  return (
    <View className={mutating ? 'opacity-50' : undefined}>
      {offerable ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('help.a11y.offerRow', locale, { need: name, state: stateLabel })}
          className={cn(shape, PRESS_DIM)}
          onPress={onHelp}
        >
          {rowContent}
        </Pressable>
      ) : (
        <View className={shape}>
          {rowContent}
          {isOwner ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('milestone.a11y.kebab', locale)}
              className={cn('min-h-[44px] min-w-[44px] items-center justify-center', PRESS_DIM)}
              onPress={() => setMenuOpen((v) => !v)}
            >
              <MoreIcon color={galleria.foreground} />
            </Pressable>
          ) : null}
        </View>
      )}

      {/* The menu opens under its row, inside the group: a black well on the charcoal block
          (`bg-background`, opaque — a translucent fill here once put the 15px delete label
          under the AA floor), no hairline of its own. */}
      {menuOpen && isOwner ? (
        <View className="mb-3 gap-1 rounded-[20px] bg-background p-2">
          {!done && onMarkDone ? (
            <Pressable
              accessibilityRole="button"
              className={cn('min-h-[44px] justify-center px-3 py-2', PRESS_DIM)}
              onPress={() => {
                setMenuOpen(false);
                onMarkDone();
              }}
            >
              <Text className="type-small text-foreground">{t('milestone.markDone', locale)}</Text>
            </Pressable>
          ) : null}
          {onDelete ? (
            <Pressable
              accessibilityRole="button"
              className={cn('min-h-[44px] justify-center px-3 py-2', PRESS_DIM)}
              onPress={confirmDelete}
            >
              <Text className="type-small text-error">{t('milestone.delete', locale)}</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}
