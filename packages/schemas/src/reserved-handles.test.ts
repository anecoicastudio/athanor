import { describe, expect, it } from 'vitest';
import { handleSchema } from './profile';
import { RESERVED_HANDLES, RESERVED_HANDLE_PREFIX, isReservedHandle } from './reserved-handles';

describe('RESERVED_HANDLES', () => {
  it('holds only values the handle shape itself would admit', () => {
    // A reserved entry the column could never hold is a dead entry: it reserves nothing and
    // makes the DB constraint carry a value its own regex rejects.
    for (const handle of RESERVED_HANDLES) {
      expect(handleSchema.safeParse(handle).success, handle).toBe(true);
    }
  });

  it('leaves room for the underscore suggestHandle appends', () => {
    // `suggestHandle` escapes a listed handle by suffixing `_`, and the column caps at 30. Held
    // here as a static invariant rather than a runtime slice in the generator: no input can
    // reach such a slice today (the longest entry is 14), so the branch would be untestable —
    // and a 30-character entry added later would raise 23514 on the very path this guard exists
    // to keep working.
    for (const handle of RESERVED_HANDLES) {
      expect(handle.length, handle).toBeLessThanOrEqual(29);
    }
  });

  it('is sorted and free of duplicates', () => {
    // Sorted so an addition lands in one obvious place and the mirror test's order equality
    // against the SQL array stays mechanical rather than a matter of taste.
    expect([...RESERVED_HANDLES]).toEqual([...new Set(RESERVED_HANDLES)].sort());
  });

  it('reserves the Italian role words, not only the English ones', () => {
    // IT is the canonical catalogue (rules/i18n.md), so `@supporto` reads as official to the
    // member base exactly as `@support` does. An English-only list is half a guard.
    expect(RESERVED_HANDLES).toContain('supporto');
    expect(RESERVED_HANDLES).toContain('assistenza');
    expect(RESERVED_HANDLES).toContain('moderatore');
    expect(RESERVED_HANDLES).toContain('amministratore');
  });
});

describe('isReservedHandle', () => {
  it('refuses every listed handle', () => {
    for (const handle of RESERVED_HANDLES) {
      expect(isReservedHandle(handle), handle).toBe(true);
    }
  });

  it('refuses the brand prefix and anything built on it', () => {
    // Exact matching alone does not stop `athanor_support`, which is the realistic
    // impersonation, so the brand name is a prefix rule rather than a list entry.
    expect(isReservedHandle(RESERVED_HANDLE_PREFIX)).toBe(true);
    expect(isReservedHandle('athanor_support')).toBe(true);
    expect(isReservedHandle('athanorofficial')).toBe(true);
  });

  it('matches the list exactly, not by prefix', () => {
    // `admin` is reserved; `admin_luna` is a person. Only the brand gets prefix treatment.
    expect(isReservedHandle('admin_luna')).toBe(false);
    expect(isReservedHandle('supporto_luna')).toBe(false);
    expect(isReservedHandle('teamwork')).toBe(false);
  });

  it('leaves ordinary handles alone', () => {
    // Real seeded staging handles — the guard must not have grown teeth it should not have.
    expect(isReservedHandle('luna_dev')).toBe(false);
    expect(isReservedHandle('marcoaccardi89')).toBe(false);
    expect(isReservedHandle('bea_foto')).toBe(false);
  });

  it('is case-insensitive', () => {
    // The column only ever holds lowercase, but this predicate is also the client-side
    // early refusal, where the string is whatever was typed.
    expect(isReservedHandle('ADMIN')).toBe(true);
    expect(isReservedHandle('Athanor_Support')).toBe(true);
  });
});
