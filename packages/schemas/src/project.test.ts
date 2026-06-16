import { describe, expect, test } from 'vitest';
import { projectInsertSchema, projectSchema } from './project';

describe('projectSchema', () => {
  test('parses a valid project row', () => {
    const row = {
      id: '11111111-1111-1111-1111-111111111111',
      author_id: '22222222-2222-2222-2222-222222222222',
      title: 'Cerco videomaker',
      category: 'artistic',
      description: 'Per un documentario',
      terms: null,
      status: 'open',
      created_at: '2026-06-15T00:00:00Z',
      updated_at: '2026-06-15T00:00:00Z',
      deleted_at: null,
    };
    expect(projectSchema.parse(row)).toMatchObject({ category: 'artistic', status: 'open' });
  });

  test('rejects an unknown category', () => {
    expect(() =>
      projectSchema.parse({
        id: '11111111-1111-1111-1111-111111111111',
        author_id: '22222222-2222-2222-2222-222222222222',
        title: 'x',
        category: 'spam',
        description: '',
        terms: null,
        status: 'open',
        created_at: '2026-06-15T00:00:00Z',
        updated_at: '2026-06-15T00:00:00Z',
        deleted_at: null,
      }),
    ).toThrow();
  });
});

describe('projectInsertSchema', () => {
  test('trims title, requires 1–140, defaults status open + empty description', () => {
    const parsed = projectInsertSchema.parse({
      author_id: '22222222-2222-2222-2222-222222222222',
      title: '  Cerco socio  ',
      category: 'startup',
    });
    expect(parsed.title).toBe('Cerco socio');
    expect(parsed.description).toBe('');
  });

  test('rejects a blank title', () => {
    expect(() =>
      projectInsertSchema.parse({
        author_id: '22222222-2222-2222-2222-222222222222',
        title: '   ',
        category: 'startup',
      }),
    ).toThrow();
  });
});
