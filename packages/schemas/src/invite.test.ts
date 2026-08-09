import { describe, expect, it } from 'vitest';
import { inviteSchema } from './invite';

const ROW = {
  id: '00000000-0000-0000-0000-000000000001',
  inviter_id: '00000000-0000-0000-0000-000000000002',
  code: 'A1B2C3D4',
  invitee_id: '00000000-0000-0000-0000-000000000003',
  activated_at: '2026-07-07T00:00:00Z',
  created_at: '2026-07-07T00:00:00Z',
  updated_at: '2026-07-07T00:00:00Z',
};

describe('inviteSchema', () => {
  it('parses a valid row (nullable invitee/activated)', () => {
    expect(inviteSchema.parse(ROW).code).toBe('A1B2C3D4');
    expect(
      inviteSchema.parse({ ...ROW, invitee_id: null, activated_at: null }).invitee_id,
    ).toBeNull();
  });
  it('rejects a non-uuid inviter', () => {
    expect(() => inviteSchema.parse({ ...ROW, inviter_id: 'nope' })).toThrow();
  });
});
