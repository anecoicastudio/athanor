import { describe, expect, test } from 'vitest';
import { projectInsertSchema, projectSchema, projectUpdateSchema } from './project';

const validRow = {
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

  // Every row in this file carried `terms: null`, which passes whatever the bound is. A nullable
  // column needs a non-null case or its constraint is untested.
  test('bounds terms to 500 chars on the row', () => {
    expect(projectSchema.parse({ ...validRow, terms: '50/50 sui ricavi' }).terms).toBe(
      '50/50 sui ricavi',
    );
    expect(() => projectSchema.parse({ ...validRow, terms: 'x'.repeat(501) })).toThrow();
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

  test('bounds terms to 500 chars on the insert', () => {
    const base = {
      author_id: '22222222-2222-2222-2222-222222222222',
      title: 'Cerco socio',
      category: 'startup',
    };
    expect(projectInsertSchema.parse({ ...base, terms: '50/50 sui ricavi' }).terms).toBe(
      '50/50 sui ricavi',
    );
    expect(() => projectInsertSchema.parse({ ...base, terms: 'x'.repeat(501) })).toThrow();
  });
});

// The update variant re-declares description and terms rather than deriving them, so it carries
// its own copies of both bounds — untested here until now, and nothing else covers them.
describe('projectUpdateSchema', () => {
  test('accepts a partial edit', () => {
    expect(projectUpdateSchema.parse({ status: 'closed' })).toEqual({ status: 'closed' });
    expect(projectUpdateSchema.parse({})).toEqual({});
  });

  test('bounds description to 4000 chars', () => {
    expect(projectUpdateSchema.parse({ description: 'x'.repeat(4000) }).description).toHaveLength(
      4000,
    );
    expect(() => projectUpdateSchema.parse({ description: 'x'.repeat(4001) })).toThrow();
  });

  test('bounds terms to 500 chars', () => {
    expect(projectUpdateSchema.parse({ terms: '50/50 sui ricavi' }).terms).toBe('50/50 sui ricavi');
    expect(() => projectUpdateSchema.parse({ terms: 'x'.repeat(501) })).toThrow();
  });
});
