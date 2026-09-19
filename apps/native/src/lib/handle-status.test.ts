import { describe, expect, it, vi } from 'vitest';

vi.mock('@athanor/i18n', () => ({
  t: (key: string, _locale: string, params?: Record<string, string | number>) =>
    params ? `${key} ${JSON.stringify(params)}` : key,
  localeTag: (l: string) => (l === 'it' ? 'it-IT' : 'en-GB'),
}));

import {
  handleBlocksSave,
  handleRefusalMessage,
  handleStatus,
  handleStatusLine,
  isHandleClaimable,
} from './handle-status';

/**
 * #782 — what the line under the @handle field says, and whether the person may go on. A refused
 * handle always says why on screen (#769's lesson): taken, reserved and malformed are three
 * different instructions, and the cooldown carries the date it opens.
 */
describe('handleStatus', () => {
  it('is empty with nothing typed — never an error before the person has started', () => {
    expect(handleStatus('', null, 'idle')).toBe('empty');
  });

  it('names the shape before anything is asked of the database', () => {
    expect(handleStatus('ab', null, 'free')).toBe('malformed');
    expect(handleStatus('admin', null, 'free')).toBe('reserved');
  });

  it('is current when the candidate is the handle already held — no lookup, no refusal', () => {
    expect(handleStatus('luna', 'luna', 'taken')).toBe('current');
  });

  it('reports the lookup for a claimable candidate', () => {
    expect(handleStatus('luna', null, 'idle')).toBe('checking');
    expect(handleStatus('luna', null, 'checking')).toBe('checking');
    expect(handleStatus('luna', null, 'free')).toBe('free');
    expect(handleStatus('luna', null, 'taken')).toBe('taken');
    expect(handleStatus('luna', 'marco', 'failed')).toBe('unchecked');
  });
});

describe('isHandleClaimable — the onboarding CTA', () => {
  it('opens only once the handle is known free, or the check could not run', () => {
    expect(isHandleClaimable('free')).toBe(true);
    expect(isHandleClaimable('unchecked')).toBe(true);
    for (const s of ['empty', 'malformed', 'reserved', 'current', 'checking', 'taken'] as const) {
      expect(isHandleClaimable(s), s).toBe(false);
    }
  });
});

describe('handleBlocksSave — the profile editor, where the server decides the close calls', () => {
  it('blocks what can never land', () => {
    for (const s of ['empty', 'malformed', 'reserved', 'taken'] as const) {
      expect(handleBlocksSave(s), s).toBe(true);
    }
  });

  it('lets a save through while the check is in flight or could not run — the database is the gate', () => {
    for (const s of ['current', 'checking', 'free', 'unchecked'] as const) {
      expect(handleBlocksSave(s), s).toBe(false);
    }
  });
});

describe('handleStatusLine', () => {
  it('says nothing for an empty field — the rules line already speaks', () => {
    expect(handleStatusLine('empty', 'it')).toBeNull();
  });

  it('marks refusals as errors and the free handle as a confirmation', () => {
    expect(handleStatusLine('taken', 'it')).toEqual({ text: 'handle.status.taken', tone: 'error' });
    expect(handleStatusLine('reserved', 'it')).toEqual({
      text: 'handle.status.reserved',
      tone: 'error',
    });
    expect(handleStatusLine('malformed', 'it')).toEqual({
      text: 'handle.status.malformed',
      tone: 'error',
    });
    expect(handleStatusLine('free', 'it')).toEqual({ text: 'handle.status.free', tone: 'success' });
  });

  it('keeps the in-between states quiet', () => {
    for (const s of ['checking', 'current', 'unchecked'] as const) {
      expect(handleStatusLine(s, 'it')).toEqual({ text: `handle.status.${s}`, tone: 'muted' });
    }
  });
});

describe('handleRefusalMessage', () => {
  it('names a clash, a reserved word and a malformed handle as the status line does', () => {
    expect(handleRefusalMessage({ reason: 'taken' }, 'it')).toBe('handle.status.taken');
    expect(handleRefusalMessage({ reason: 'reserved' }, 'it')).toBe('handle.status.reserved');
    expect(handleRefusalMessage({ reason: 'malformed' }, 'it')).toBe('handle.status.malformed');
  });

  it('gives the cooldown the instant it opens, in the member’s language', () => {
    const message = handleRefusalMessage(
      { reason: 'cooldown', opensAt: '2026-10-19T10:00:00.000Z' },
      'it',
    );
    expect(message.startsWith('handle.cooldown ')).toBe(true);
    expect(JSON.parse(message.slice('handle.cooldown '.length)).date).toMatch(/2026/);
  });

  it('falls back to the rule itself when the server sent no date', () => {
    expect(handleRefusalMessage({ reason: 'cooldown', opensAt: null }, 'it')).toBe(
      'handle.renameHint {"days":30}',
    );
  });
});
