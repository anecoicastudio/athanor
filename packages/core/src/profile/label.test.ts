import { describe, expect, it } from 'vitest';
import { memberLabel } from './label';

describe('memberLabel', () => {
  it('prefers the name a member chose', () => {
    expect(memberLabel('Stella Prima', 'stella_p')).toBe('Stella Prima');
  });

  it('falls back to @handle — the identity that always exists', () => {
    expect(memberLabel(null, 'stella_p')).toBe('@stella_p');
  });

  it('trims the name, so trailing padding never shifts a row', () => {
    expect(memberLabel('  Stella  ', 'stella_p')).toBe('Stella');
  });

  it('treats a padding-only name as no name at all', () => {
    expect(memberLabel('   ', 'stella_p')).toBe('@stella_p');
  });

  it('returns null when neither exists, rather than inventing a placeholder', () => {
    // A placeholder is UI copy — «—», «membro sconosciuto» — and copy belongs in i18n, not here.
    expect(memberLabel(null, null)).toBeNull();
    expect(memberLabel(undefined, undefined)).toBeNull();
  });

  it('never prefixes the name with @ — that mark belongs to the handle alone', () => {
    expect(memberLabel('Stella', 'stella_p')?.startsWith('@')).toBe(false);
  });
});
