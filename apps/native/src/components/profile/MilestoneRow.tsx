import { useState } from 'react';
import { Alert } from 'react-native';
import { t } from '@athanor/i18n';
import type { Locale, MilestoneStatus } from '@athanor/schemas';
import { Pressable, Text, View } from '@/tw';
import { isHelpableStatus, type HelpState } from '@/lib/help-picker';

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
 * One tappa row (frontend `02` §3.1/§4): leading check-glyph + the need + trailing
 * state text. Owner mode (handlers present) adds a kebab → «Segna come fatta» / «Elimina».
 * Read mode (no handlers) renders glyph + name + state only. Never writes Aura (rule #1).
 * Helper mode (someone else's dream): pass `helpState` for the trailing «Aiuta» /
 * help-state affordance (frontend `02` §3.4C). Helper rows aren't editable — the kebab
 * is never shown when `helpState` is set.
 *
 * In helper mode with an offer still to make, THE WHOLE ROW IS THE BUTTON (#660). It used to
 * be the trailing «Aiuta» alone, next to a `○` that is the row's largest glyph (`text-base`
 * inlines at 14 on device against the label's literal 13px) and reads exactly like a
 * selection control — a tester kept pressing the left side, which did nothing. Two changes,
 * both from DESIGN.md: the row becomes one accessible button, `SettingsRow`'s shape and
 * §8.13's «rows are single accessible buttons» (so the `○` honestly participates instead of
 * lying), and «Aiuta» takes the framed chip geometry `FavorRow` already ships for the same
 * word, so the CTA stops reading as a link to an explainer.
 *
 * The chip is a `View`, never a nested `Pressable`: source-audit §21 forbids one inside
 * another (an accessible ancestor is atomic to VoiceOver) and its register is empty by
 * design. Its `aura-soft` frame is the accent-chip treatment, not the glow — picking a tappa
 * is a navigation step, and even the offer it leads to is ruled not moment-grade
 * (`(modal)/help.tsx`'s CTA comment). The row's own label carries the name and the state,
 * because an accessible ancestor masks the children that render them.
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

  const confirmDelete = () => {
    setMenuOpen(false);
    if (!onDelete) return;
    Alert.alert(t('milestone.delete.confirm', locale), undefined, [
      { text: t('common.cancel', locale), style: 'cancel' },
      { text: t('milestone.delete', locale), style: 'destructive', onPress: onDelete },
    ]);
  };

  // Held in a const so the wrapper below can be a Pressable without the owner kebab ending up
  // INSIDE it — source-audit §21 walks tag depth over the file, and the two arms are mutually
  // exclusive at runtime but not in the source text. The kebab only ever renders when
  // `isOwner`, which requires no `helpState` at all, so the two can never nest at runtime
  // either. Read the trade before adding to this const: §21 cannot see through it, so a
  // Pressable put in here would nest under the wrapper at runtime with nothing going red.
  const rowContent = (
    <>
      {/* leading glyph: ✓ done (aura), ○ open (faint) */}
      <Text
        className={done ? 'text-base text-aura' : 'text-base text-faint'}
        // Silent on the offerable arm: the row is the button there and its label already says
        // which tappa and in what state, so a second announcement is the same fact twice
        // (#635). `SettingsRow`'s children carry no labels for the same reason.
        accessibilityLabel={
          offerable ? undefined : t(done ? 'milestone.a11y.done' : 'milestone.a11y.open', locale)
        }
      >
        {done ? '✓' : '○'}
      </Text>
      <Text
        className={`flex-1 text-[15px] ${done ? 'text-faint line-through' : 'text-foreground'}`}
      >
        {name}
      </Text>
      <Text className="text-[12px] text-faint">{stateLabel}</Text>
      {offerable ? (
        <View className="rounded-ctl border border-aura-line bg-aura-soft px-4 py-1.5">
          <Text className="text-[13px] text-aura">{t('help.cta', locale)}</Text>
        </View>
      ) : helpState && helpState !== 'available' ? (
        <Text className="text-[12px] text-faint">{t(HELP_LABEL_KEY[helpState], locale)}</Text>
      ) : null}
      {isOwner ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('milestone.a11y.kebab', locale)}
          hitSlop={{ top: 16, bottom: 16, left: 16, right: 16 }}
          onPress={() => setMenuOpen((v) => !v)}
        >
          <Text className="px-1 text-lg text-faint">⋯</Text>
        </Pressable>
      ) : null}
    </>
  );

  return (
    <View className={`gap-2 ${mutating ? 'opacity-50' : ''}`}>
      {offerable ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('help.a11y.offerRow', locale, { need: name, state: stateLabel })}
          // Literal 44px, never `h-11`: a spacing step is 3.5px on device, so the class form
          // is 38.5pt there while measuring a passing 44 on the web walk (§29, #638).
          className="min-h-[44px] flex-row items-center gap-3"
          onPress={onHelp}
        >
          {rowContent}
        </Pressable>
      ) : (
        <View className="flex-row items-center gap-3">{rowContent}</View>
      )}

      {/* `bg-surface` on the menu below is OPAQUE, and that is load-bearing, not cosmetic. As
          translucent `bg-raise-2` this popover inherited DreamCard's `bg-raise` beneath it,
          compositing to #232331 — where the 15px delete label sat at 3.90:1, under the AA
          floor. Opaque means the menu no longer depends on whatever it floats over. */}
      {menuOpen && isOwner ? (
        <View className="ml-7 gap-1 rounded-card border border-hair bg-surface p-2">
          {!done && onMarkDone ? (
            <Pressable
              accessibilityRole="button"
              className="min-h-[44px] justify-center px-3 py-2"
              onPress={() => {
                setMenuOpen(false);
                onMarkDone();
              }}
            >
              <Text className="text-[15px] text-foreground">{t('milestone.markDone', locale)}</Text>
            </Pressable>
          ) : null}
          {onDelete ? (
            <Pressable
              accessibilityRole="button"
              className="min-h-[44px] justify-center px-3 py-2"
              onPress={confirmDelete}
            >
              <Text className="text-[15px] text-error">{t('milestone.delete', locale)}</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}
