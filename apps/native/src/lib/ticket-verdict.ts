import { t } from '@athanor/i18n';
import type { CheckInResult } from '@athanor/schemas';

/**
 * 'error' = the scan REQUEST failed (network/edge-fn down) — distinct from 'invalid'
 * (a verified verdict about the ticket) so a transient outage never reads as a bad ticket.
 */
export type Verdict = CheckInResult['result'] | 'error';

export function verdictText(v: Verdict, name: string | undefined, locale: 'it' | 'en'): string {
  switch (v) {
    case 'valid':
      return t('ticket.scan.welcome', locale, { name: name ?? t('ticket.scan.someone', locale) });
    case 'already':
      return t('ticket.scan.already', locale);
    case 'wrongEvent':
      return t('ticket.scan.wrongEvent', locale);
    case 'error':
      return t('ticket.scan.error', locale);
    default:
      return t('ticket.scan.invalid', locale);
  }
}
