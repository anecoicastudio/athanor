import { expect, test } from 'vitest';
import { tierOf } from './tier.ts';

test('tier bands (frontend §3.4)', () => {
  expect(tierOf(0)).toBe('scintilla');
  expect(tierOf(249)).toBe('scintilla');
  expect(tierOf(250)).toBe('bagliore');
  expect(tierOf(500)).toBe('luce');
  expect(tierOf(750)).toBe('faro');
  expect(tierOf(1000)).toBe('costellazione');
});
