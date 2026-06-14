import { useState } from 'react';
import { Alert } from 'react-native';
import { t } from '@auria/i18n';
import type { Locale, MilestoneStatus } from '@auria/schemas';
import { Pressable, Text, View } from '@/tw';

const STATE_KEY = {
  open: 'milestone.state.open',
  in_progress: 'milestone.state.inProgress',
  done: 'milestone.state.done',
} as const;

/**
 * One tappa row (frontend `02` §3.1/§4): leading check-glyph + the need + trailing
 * state text. Owner mode (handlers present) adds a kebab → «Segna come fatta» / «Elimina».
 * Read mode (no handlers) renders glyph + name + state only. Never writes Aura (rule #1).
 */
export function MilestoneRow({
  name,
  status,
  locale,
  mutating = false,
  onMarkDone,
  onDelete,
}: {
  name: string;
  status: MilestoneStatus;
  locale: Locale;
  mutating?: boolean;
  onMarkDone?: () => void;
  onDelete?: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const done = status === 'done';
  const isOwner = Boolean(onMarkDone || onDelete);

  const confirmDelete = () => {
    setMenuOpen(false);
    if (!onDelete) return;
    Alert.alert(t('milestone.delete.confirm', locale), undefined, [
      { text: t('common.cancel', locale), style: 'cancel' },
      { text: t('milestone.delete', locale), style: 'destructive', onPress: onDelete },
    ]);
  };

  return (
    <View className={`gap-2 ${mutating ? 'opacity-50' : ''}`}>
      <View className="flex-row items-center gap-3">
        {/* leading glyph: ✓ done (aura), ○ open (faint) */}
        <Text
          className={done ? 'text-base text-aura' : 'text-base text-faint'}
          accessibilityLabel={t(done ? 'milestone.a11y.done' : 'milestone.a11y.open', locale)}
        >
          {done ? '✓' : '○'}
        </Text>
        <Text
          className={`flex-1 text-[15px] ${done ? 'text-faint line-through' : 'text-foreground'}`}
        >
          {name}
        </Text>
        <Text className="text-[12px] text-faint">{t(STATE_KEY[status], locale)}</Text>
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
      </View>

      {menuOpen && isOwner ? (
        <View className="ml-7 gap-1 rounded-card border border-hair bg-raise-2 p-2">
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
