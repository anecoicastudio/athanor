import { describe, expect, it } from 'vitest';
import {
  publicDreamAuthorSchema,
  publicDreamEntrySchema,
  publicDreamSchema,
} from './public-dream.ts';

const row = {
  id: '11111111-1111-4111-8111-111111111111',
  text: 'Aprire uno studio che lavori solo su progetti che lasciano il mondo un po’ più chiaro.',
  milestones: [
    { id: 'm1', body: 'Trovare lo spazio', status: 'open' },
    { id: 'm2', body: 'Il primo cliente', status: 'done' },
  ],
  author: { handle: 'sole', displayName: 'Sole', avatarUrl: 'https://cdn.test/a.png?token=x' },
};

describe('publicDreamSchema', () => {
  it('parses a dream with a byline and tappe', () => {
    const parsed = publicDreamSchema.parse(row);
    expect(parsed.author?.handle).toBe('sole');
    expect(parsed.milestones).toHaveLength(2);
  });

  it('parses a dream whose owner carries no handle', () => {
    // The reachable no-byline case, and the only one: an identity-private or banned owner
    // hides the DREAM row from anon too, through the exists in dreams_select_anon_public
    // (20260814151601, «CONSEQUENCE, DELIBERATE»), so it never reaches this model at all.
    const parsed = publicDreamSchema.parse({ ...row, author: null });
    expect(parsed.author).toBeNull();
  });

  it('parses a dream with no tappe', () => {
    expect(publicDreamSchema.parse({ ...row, milestones: [] }).milestones).toEqual([]);
  });

  /*
   * The point of a separate public read-model. `profile_id` is read to resolve the byline and
   * must never reach the page; `status` and `deleted_at` cannot vary under anon RLS, so a
   * caller must not be handed something to branch on. .strict() makes a widened select a loud
   * parse error rather than a silent leak the day someone reuses dreamSchema's column list.
   */
  it.each(['profile_id', 'status', 'deleted_at', 'created_at', 'updated_at'])(
    'rejects a row carrying %s',
    (column) => {
      expect(publicDreamSchema.safeParse({ ...row, [column]: 'x' }).success).toBe(false);
    },
  );

  it('rejects a non-uuid id and blank text', () => {
    expect(publicDreamSchema.safeParse({ ...row, id: 'not-a-uuid' }).success).toBe(false);
    expect(publicDreamSchema.safeParse({ ...row, text: '' }).success).toBe(false);
  });

  it('rejects an unknown milestone status', () => {
    // The vocabulary is milestone.ts's, not a second copy of it.
    expect(
      publicDreamSchema.safeParse({
        ...row,
        milestones: [{ id: 'm1', body: 'x', status: 'bogus' }],
      }).success,
    ).toBe(false);
  });
});

describe('publicDreamAuthorSchema', () => {
  it('rejects a handle that is not a valid handle', () => {
    expect(publicDreamAuthorSchema.safeParse({ ...row.author, handle: 'Sole' }).success).toBe(
      false,
    );
  });

  it('accepts a shell with neither name nor photo — initials render instead', () => {
    const parsed = publicDreamAuthorSchema.parse({
      handle: 'sole',
      displayName: null,
      avatarUrl: null,
    });
    expect(parsed.displayName).toBeNull();
  });

  it('rejects an avatar that is a storage key rather than a signed url', () => {
    expect(
      publicDreamAuthorSchema.safeParse({ ...row.author, avatarUrl: 'avatars/x.png' }).success,
    ).toBe(false);
  });
});

describe('publicDreamEntrySchema', () => {
  const entry = { id: '00000000-0000-0000-0000-0000000000d1', updated_at: '2026-08-01T10:00:00Z' };

  it('accepts an id + updated_at pair', () => {
    expect(publicDreamEntrySchema.parse(entry)).toEqual(entry);
  });

  it('rejects a non-uuid id', () => {
    expect(publicDreamEntrySchema.safeParse({ ...entry, id: 'nope' }).success).toBe(false);
  });

  it('stays strict: a widened select fails loudly instead of carrying an unasked column', () => {
    expect(publicDreamEntrySchema.safeParse({ ...entry, profile_id: 'x' }).success).toBe(false);
  });
});
