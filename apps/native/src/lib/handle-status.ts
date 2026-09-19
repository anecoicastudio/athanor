import type { HandleClaimRefusal } from '@athanor/api';
import { HANDLE_RENAME_COOLDOWN_DAYS, classifyHandle } from '@athanor/core';
import { t } from '@athanor/i18n';
import type { Locale } from '@athanor/schemas';
import { dateTimeWithYear } from './time';

/** The live lookup's answer for ONE candidate — `idle` until it has been asked. */
export type HandleLookup = 'idle' | 'checking' | 'taken' | 'free' | 'failed';

/**
 * What the @handle field says about what was typed (#782). `current` is the handle the member
 * already holds (the profile editor); `unchecked` means the availability lookup could not run —
 * the database's unique index is the gate either way, so that is a note, not a refusal.
 */
export type HandleStatus =
  | 'empty'
  | 'malformed'
  | 'reserved'
  | 'current'
  | 'checking'
  | 'taken'
  | 'free'
  | 'unchecked';

/** Combine the shape verdict (@athanor/core) with the lookup. The shape is judged first: a
 *  handle the column would refuse is never sent to the database to be looked up. */
export function handleStatus(
  candidate: string,
  current: string | null,
  lookup: HandleLookup,
): HandleStatus {
  const verdict = classifyHandle(candidate);
  if (verdict !== 'claimable') return verdict;
  if (candidate === current) return 'current';
  if (lookup === 'taken') return 'taken';
  if (lookup === 'free') return 'free';
  if (lookup === 'failed') return 'unchecked';
  return 'checking';
}

/** Onboarding's «Continua»: only a handle known to be free — or one the lookup could not check,
 *  which the claim itself will then settle — can be chosen. */
export function isHandleClaimable(status: HandleStatus): boolean {
  return status === 'free' || status === 'unchecked';
}

/** The profile editor's save: blocked only by what can never land. A lookup still in flight does
 *  not hold the whole profile hostage — the claim is refused by the database if it must be. */
export function handleBlocksSave(status: HandleStatus): boolean {
  return (
    status === 'empty' || status === 'malformed' || status === 'reserved' || status === 'taken'
  );
}

export type HandleStatusLine = { text: string; tone: 'error' | 'success' | 'muted' };

/** The line under the field, or `null` when the rules line alone should speak (nothing typed). */
export function handleStatusLine(status: HandleStatus, locale: Locale): HandleStatusLine | null {
  if (status === 'empty') return null;
  const text = t(`handle.status.${status}`, locale);
  if (status === 'taken' || status === 'reserved' || status === 'malformed') {
    return { text, tone: 'error' };
  }
  return { text, tone: status === 'free' ? 'success' : 'muted' };
}

/** A database refusal of the claim, in words (`handleClaimRefusal` names it). */
export function handleRefusalMessage(refusal: HandleClaimRefusal, locale: Locale): string {
  if (refusal.reason !== 'cooldown') return t(`handle.status.${refusal.reason}`, locale);
  if (refusal.opensAt === null) {
    return t('handle.renameHint', locale, { days: HANDLE_RENAME_COOLDOWN_DAYS });
  }
  return t('handle.cooldown', locale, { date: dateTimeWithYear(refusal.opensAt, locale) });
}
