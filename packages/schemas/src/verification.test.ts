import { describe, expect, it } from 'vitest';
import { verificationSchema, VERIFICATION_STATUSES } from './verification';

describe('verificationSchema', () => {
  const valid = {
    id: '11111111-1111-1111-1111-111111111111',
    profile_id: '22222222-2222-2222-2222-222222222222',
    stripe_session_id: 'vs_abc123',
    status: 'pending' as const,
    created_at: '2026-06-20T00:00:00.000Z',
    updated_at: '2026-06-20T00:00:00.000Z',
  };

  it('parses a valid verification row', () => {
    expect(verificationSchema.parse(valid)).toMatchObject({ status: 'pending' });
  });

  it('rejects an unknown status', () => {
    expect(() => verificationSchema.parse({ ...valid, status: 'approved' })).toThrow();
  });

  it('exposes the three statuses', () => {
    expect(VERIFICATION_STATUSES).toEqual(['pending', 'verified', 'failed']);
  });
});
