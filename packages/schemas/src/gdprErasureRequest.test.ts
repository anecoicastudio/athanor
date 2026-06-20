import { describe, expect, it } from 'vitest';
import { gdprErasureRequestSchema, GDPR_ERASURE_STATUSES } from './gdprErasureRequest';

const validRow = {
  id: '11111111-1111-1111-1111-111111111111',
  profile_id: '22222222-2222-2222-2222-222222222222',
  status: 'requested' as const,
  created_at: '2026-06-20T00:00:00Z',
  updated_at: '2026-06-20T00:00:00Z',
};

describe('gdprErasureRequestSchema', () => {
  it('parses a valid row', () => {
    expect(gdprErasureRequestSchema.parse(validRow).status).toBe('requested');
  });
  it('rejects an unknown status', () => {
    expect(() => gdprErasureRequestSchema.parse({ ...validRow, status: 'cancelled' })).toThrow();
  });
  it('lists exactly the four statuses', () => {
    expect(GDPR_ERASURE_STATUSES).toEqual(['requested', 'processing', 'done', 'failed']);
  });
});
