import { describe, expect, it } from 'vitest';
import {
  gdprExportJobSchema,
  gdprRequestInsertSchema,
  GDPR_EXPORT_STATUSES,
} from './gdprExportJob.ts';

const validRow = {
  id: '11111111-1111-1111-1111-111111111111',
  profile_id: '22222222-2222-2222-2222-222222222222',
  status: 'ready' as const,
  download_url: 'https://example.test/x',
  expires_at: '2026-07-01T00:00:00Z',
  created_at: '2026-06-20T00:00:00Z',
  updated_at: '2026-06-20T00:00:00Z',
};

describe('gdprExportJobSchema', () => {
  it('parses a valid row', () => {
    expect(gdprExportJobSchema.parse(validRow).status).toBe('ready');
  });
  it('accepts null download_url/expires_at (requested state)', () => {
    expect(() =>
      gdprExportJobSchema.parse({
        ...validRow,
        status: 'requested',
        download_url: null,
        expires_at: null,
      }),
    ).not.toThrow();
  });
  it('rejects an unknown status', () => {
    expect(() => gdprExportJobSchema.parse({ ...validRow, status: 'deleted' })).toThrow();
  });
  it('lists exactly the three statuses', () => {
    expect(GDPR_EXPORT_STATUSES).toEqual(['requested', 'processing', 'ready']);
  });
});

describe('gdprRequestInsertSchema', () => {
  it('parses the owner-enqueue payload and nothing more', () => {
    expect(gdprRequestInsertSchema.parse({ profile_id: validRow.profile_id })).toEqual({
      profile_id: validRow.profile_id,
    });
    // status is server-pinned by RLS WITH CHECK — a smuggled value must not survive the parse
    expect(
      gdprRequestInsertSchema.parse({ profile_id: validRow.profile_id, status: 'done' }),
    ).toEqual({ profile_id: validRow.profile_id });
  });

  it('rejects a non-uuid profile_id', () => {
    expect(() => gdprRequestInsertSchema.parse({ profile_id: 'me' })).toThrow();
    expect(() => gdprRequestInsertSchema.parse({})).toThrow();
  });
});
