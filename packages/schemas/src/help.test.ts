import { describe, expect, it } from 'vitest';
import { helpInsertSchema, helpRespondSchema, helpSchema } from './help';

const validRow = {
  id: '00000000-0000-0000-0000-000000000001',
  milestone_id: '00000000-0000-0000-0000-000000000002',
  helper_id: '00000000-0000-0000-0000-000000000003',
  type: 'skill',
  message: 'Posso disegnarti il logo.',
  link: 'https://example.com/portfolio',
  status: 'offered',
  created_at: '2026-06-14T00:00:00Z',
  updated_at: '2026-06-14T00:00:00Z',
  deleted_at: null,
};

describe('helpSchema', () => {
  it('parses a valid row', () => {
    expect(helpSchema.parse(validRow).type).toBe('skill');
  });
  it('rejects an unknown type', () => {
    expect(() => helpSchema.parse({ ...validRow, type: 'contribution' })).toThrow();
  });
  it('rejects a non-http link', () => {
    expect(() => helpSchema.parse({ ...validRow, link: 'ftp://x' })).toThrow();
  });
  it('rejects a message over 500 chars', () => {
    expect(() => helpSchema.parse({ ...validRow, message: 'x'.repeat(501) })).toThrow();
  });
});

describe('helpInsertSchema', () => {
  it('accepts a helper offer with trimmed message', () => {
    const parsed = helpInsertSchema.parse({
      milestone_id: validRow.milestone_id,
      type: 'connection',
      message: '  ti presento un mentor  ',
    });
    expect(parsed.message).toBe('ti presento un mentor');
  });
  it('allows omitting message and link', () => {
    expect(
      helpInsertSchema.parse({ milestone_id: validRow.milestone_id, type: 'opportunity' }).type,
    ).toBe('opportunity');
  });
});

describe('helpRespondSchema', () => {
  it('accepts accepted/declined/completed', () => {
    expect(helpRespondSchema.parse({ status: 'accepted' }).status).toBe('accepted');
  });
  it('rejects offered as a response target', () => {
    expect(() => helpRespondSchema.parse({ status: 'offered' })).toThrow();
  });
});
