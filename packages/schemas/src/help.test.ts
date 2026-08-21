import { describe, expect, it } from 'vitest';
import {
  helpInsertSchema,
  helpRespondSchema,
  helpSchema,
  helpStatusSchema,
  helpTypeSchema,
} from './help';

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
  // 'ftp://x' contains no "http" at all, so it is rejected with or without the `^` anchor.
  // A scheme that merely CONTAINS http:// later in the string is what the anchor is for —
  // without it, `javascript:...` carrying an http substring would pass a link check.
  it('rejects a link that only contains http:// rather than starting with it', () => {
    expect(() => helpSchema.parse({ ...validRow, link: 'ftp://x/http://y' })).toThrow();
    expect(() => helpSchema.parse({ ...validRow, link: ' https://example.com' })).toThrow();
  });
  // Every other link in this file is https://, so the `s?` could be dropped unnoticed and
  // plain http:// links — still the majority of the small web — would stop parsing.
  it('accepts a plain http:// link, not only https://', () => {
    expect(helpSchema.parse({ ...validRow, link: 'http://example.com/portfolio' }).link).toBe(
      'http://example.com/portfolio',
    );
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

// Mirrors milestone_helps — the literal list, never a loop over the constant.
describe('help vocabularies', () => {
  it('type is skill | connection | opportunity — no contribution in Fase 1', () => {
    expect(helpTypeSchema.options).toEqual(['skill', 'connection', 'opportunity']);
  });

  it('status is offered → accepted | declined → completed', () => {
    expect(helpStatusSchema.options).toEqual(['offered', 'accepted', 'declined', 'completed']);
    for (const bad of ['withdrawn', 'pending', '']) {
      expect(helpStatusSchema.safeParse(bad).success).toBe(false);
    }
  });

  it('respond targets are the vocabulary minus offered — each reachable, offered never', () => {
    expect(helpRespondSchema.shape.status.options).toEqual(['accepted', 'declined', 'completed']);
    for (const status of ['accepted', 'declined', 'completed']) {
      expect(helpRespondSchema.parse({ status }).status).toBe(status);
    }
  });
});
