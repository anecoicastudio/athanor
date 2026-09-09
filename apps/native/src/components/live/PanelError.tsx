import { type Locale, t } from '@athanor/i18n';
import { ListState } from '@/components/ListState';

/**
 * Shared error state for the four Live panels: message + retry.
 *
 * A thin wrapper over `ListState` rather than its own markup (#111) — the four panels each
 * early-return on `query.isError`, so the decision is already made and only the arm is needed.
 * It used to hand-roll a `border-aura-line bg-aura-soft` pill of its own. Rule #4 does not
 * reserve that surface — without a shadow the framed pair is the ordinary active one (§2.3,
 * ruled 2026-09-07) — but an error state should not read as the brightest block on the panel.
 * The defect #119 (closed) counted was the hand-rolled copies, not the colour: one retry
 * recipe, and it is `ListState`'s.
 */
export function PanelError({ locale, onRetry }: { locale: Locale; onRetry: () => void }) {
  return (
    <ListState
      state="error"
      locale={locale}
      errorLabel={t('live.error', locale)}
      onRetry={onRetry}
      className="flex-1 justify-center px-5"
    />
  );
}
