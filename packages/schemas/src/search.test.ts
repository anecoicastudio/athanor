import { describe, expect, test } from 'vitest';
import {
  searchResultSchema,
  searchFiltersSchema,
  searchScopeSchema,
  searchEntitySchema,
} from './search';

describe('search schemas', () => {
  test('parses a valid search result row', () => {
    const row = {
      entity_type: 'person',
      id: '00000000-0000-0000-0000-000000000001',
      title: 'elena',
      subtitle: 'bio snippet',
      display_name: 'Elena Conti',
      avatar_path: 'e/e.jpg',
      rank: 0.8,
    };
    expect(searchResultSchema.parse(row).entity_type).toBe('person');
    expect(searchResultSchema.parse(row).rank).toBe(0.8);
  });

  test('rejects a bad entity_type', () => {
    const row = {
      entity_type: 'listing',
      id: '00000000-0000-0000-0000-000000000001',
      title: 'test',
      subtitle: 'test',
      rank: 0.5,
    };
    expect(searchResultSchema.safeParse(row).success).toBe(false);
  });

  test('parses a valid filter set with all fields', () => {
    const filters = {
      auraMin: 500,
      city: 'Milano',
      star: 'creatore',
    };
    expect(searchFiltersSchema.parse(filters).auraMin).toBe(500);
    expect(searchFiltersSchema.parse(filters).city).toBe('Milano');
    expect(searchFiltersSchema.parse(filters).star).toBe('creatore');
  });

  test('parses an empty filter set (all optional)', () => {
    const filters = {};
    expect(searchFiltersSchema.parse(filters)).toEqual({});
  });

  test('rejects auraMin over max (1000)', () => {
    const filters = {
      auraMin: 1001,
    };
    expect(searchFiltersSchema.safeParse(filters).success).toBe(false);
  });

  test('rejects an invalid star value', () => {
    const filters = {
      star: 'invalid_star',
    };
    expect(searchFiltersSchema.safeParse(filters).success).toBe(false);
  });

  test('validates searchScope enum', () => {
    expect(searchScopeSchema.parse('all')).toBe('all');
    expect(searchScopeSchema.parse('people')).toBe('people');
    expect(searchScopeSchema.parse('marketplace')).toBe('marketplace');
  });

  test('validates searchEntity enum (listing not included)', () => {
    expect(searchEntitySchema.parse('person')).toBe('person');
    expect(searchEntitySchema.parse('project')).toBe('project');
    expect(searchEntitySchema.parse('event')).toBe('event');
    expect(searchEntitySchema.safeParse('listing').success).toBe(false);
  });
});
