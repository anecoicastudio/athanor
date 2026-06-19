import { expect, test } from 'vitest';
import { searchKeys } from './search';

test('searchKeys.all shape', () => {
  expect(searchKeys.all).toEqual(['search']);
});

test('searchKeys.query factory shape', () => {
  expect(searchKeys.query('mar', 'people')).toEqual([
    'search',
    'query',
    { q: 'mar', scope: 'people', filters: undefined },
  ]);
});

test('searchKeys.query includes filters when provided', () => {
  const filters = { auraMin: 10, city: 'Milano' };
  expect(searchKeys.query('mar', 'projects', filters)).toEqual([
    'search',
    'query',
    { q: 'mar', scope: 'projects', filters },
  ]);
});

test('searchKeys.query with all scope and no filters', () => {
  expect(searchKeys.query('', 'all')).toEqual([
    'search',
    'query',
    { q: '', scope: 'all', filters: undefined },
  ]);
});
