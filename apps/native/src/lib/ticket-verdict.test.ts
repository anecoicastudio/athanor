import { describe, expect, it } from 'vitest';
import { t } from '@athanor/i18n';
import { type Verdict, verdictText } from './ticket-verdict';

const ALL: Verdict[] = ['valid', 'already', 'invalid', 'wrongEvent', 'error'];

describe('verdictText — the five outcomes', () => {
  it('valid greets the holder by name', () => {
    expect(verdictText('valid', 'marco', 'en')).toBe(
      t('ticket.scan.welcome', 'en', { name: 'marco' }),
    );
    expect(verdictText('valid', 'marco', 'en')).toContain('marco');
  });

  it('valid without a name falls back to «un ospite», never an empty greeting', () => {
    const en = verdictText('valid', undefined, 'en');
    expect(en).toContain(t('ticket.scan.someone', 'en'));
    expect(en).not.toContain('undefined');
    const it = verdictText('valid', undefined, 'it');
    expect(it).toContain(t('ticket.scan.someone', 'it'));
  });

  it('already → already-checked-in copy', () => {
    expect(verdictText('already', undefined, 'en')).toBe(t('ticket.scan.already', 'en'));
  });

  it('wrongEvent → ticket-for-another-event copy', () => {
    expect(verdictText('wrongEvent', undefined, 'en')).toBe(t('ticket.scan.wrongEvent', 'en'));
  });

  it('invalid → invalid-ticket copy', () => {
    expect(verdictText('invalid', undefined, 'en')).toBe(t('ticket.scan.invalid', 'en'));
  });

  it('error → retry copy', () => {
    expect(verdictText('error', undefined, 'en')).toBe(t('ticket.scan.error', 'en'));
  });
});

describe('verdictText — error is load-bearing, distinct from invalid', () => {
  it('a transport failure never reads as a bad ticket', () => {
    expect(verdictText('error', undefined, 'en')).not.toBe(verdictText('invalid', undefined, 'en'));
    expect(verdictText('error', undefined, 'it')).not.toBe(verdictText('invalid', undefined, 'it'));
  });

  it('the five outcomes produce five distinct messages', () => {
    const messages = ALL.map((v) => verdictText(v, 'marco', 'en'));
    expect(new Set(messages).size).toBe(ALL.length);
  });

  it("the holder's name is only used by the valid branch", () => {
    for (const v of ALL.filter((x) => x !== 'valid')) {
      expect(verdictText(v, 'marco', 'en')).not.toContain('marco');
    }
  });
});

describe('verdictText — localisation', () => {
  it('every outcome is translated in both locales and leaks no key', () => {
    for (const v of ALL) {
      const it = verdictText(v, 'marco', 'it');
      const en = verdictText(v, 'marco', 'en');
      expect(it).not.toContain('ticket.scan.');
      expect(en).not.toContain('ticket.scan.');
      expect(it.length).toBeGreaterThan(0);
      expect(en.length).toBeGreaterThan(0);
    }
  });

  it('no message leaves an unsubstituted placeholder', () => {
    for (const v of ALL) {
      expect(verdictText(v, 'marco', 'it')).not.toMatch(/\{\w+\}/);
      expect(verdictText(v, undefined, 'en')).not.toMatch(/\{\w+\}/);
    }
  });
});
