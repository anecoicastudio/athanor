import { type Locale, t } from '@athanor/i18n';
import { ListState } from '@/components/ListState';

/**
 * Shared error state for the four Live panels: message + retry.
 *
 * A thin wrapper over `ListState` rather than its own markup (#111) — the four panels each
 * early-return on `query.isError`, so the decision is already made and only the arm is needed.
 * It used to hand-roll the `border-aura-line bg-aura-soft` pill, which rule #4 reserves for
 * moment-grade events; a failed fetch is the opposite of a moment, and #119 counts the copies.
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
