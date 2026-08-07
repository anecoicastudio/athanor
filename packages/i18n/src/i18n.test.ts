import { describe, expect, test } from 'vitest';
import en from './catalogs/en.json';
import it from './catalogs/it.json';
import { t, type MessageKey } from './t';

describe('catalog parity', () => {
  test('EN mirrors every IT key (IT is canonical)', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(it).sort());
  });
});

describe('t', () => {
  test('returns Italian copy for it locale', () => {
    expect(t('moment.new', 'it')).toBe('Hai un Momento');
  });

  test('returns English copy for en locale', () => {
    expect(t('moment.new', 'en')).toBe('You have a Moment');
  });

  test('substitutes {var} placeholders when vars provided', () => {
    const key = (Object.keys(it) as MessageKey[]).find((k) => /\{\w+\}/.test(it[k]));
    expect(key).toBeDefined();
    const name = /\{(\w+)\}/.exec(it[key!])![1]!;
    expect(t(key!, 'it', { [name]: 'X7' })).toContain('X7');
    expect(t(key!, 'it', { [name]: 'X7' })).not.toContain(`{${name}}`);
  });

  test('leaves unknown placeholders intact', () => {
    const key = (Object.keys(it) as MessageKey[]).find((k) => /\{\w+\}/.test(it[k]));
    const name = /\{(\w+)\}/.exec(it[key!])![1]!;
    // vars provided but without the matching name — placeholder survives verbatim
    expect(t(key!, 'it', { unrelated: 1 })).toContain(`{${name}}`);
  });
});

describe('catalog quality', () => {
  // `?? ''` keeps the failure self-describing if a key is missing from one
  // catalog (the `catalog parity` test catches that first, but don't throw here).
  const placeholders = (s: string | undefined): string[] =>
    [...new Set((s ?? '').match(/\{(\w+)\}/g) ?? [])].sort();

  // I-4: every {var} present in IT is present in EN for the same key (and vice-versa).
  test('placeholder sets match IT<->EN per key', () => {
    const mismatches: string[] = [];
    for (const key of Object.keys(it) as MessageKey[]) {
      const a = placeholders(it[key]);
      const b = placeholders(en[key]);
      if (a.join(',') !== b.join(',')) mismatches.push(`${key}: IT [${a}] EN [${b}]`);
    }
    expect(mismatches).toEqual([]);
  });

  // I-3: Athanor voice — no vanity/tech-speak in any value, either locale.
  // «Notifiche» (plural feature title) is fine; \bnotifica\b targets the singular vanity sense.
  test('no banned vanity/tech-speak terms in any value', () => {
    const banned = [/\bengagement\b/i, /\butenti\b/i, /\bnotifica\b/i];
    const offenders: string[] = [];
    for (const cat of [it, en] as Record<string, string>[]) {
      for (const [key, value] of Object.entries(cat)) {
        for (const re of banned) if (re.test(value)) offenders.push(`${key}: "${value}" ~ ${re}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
