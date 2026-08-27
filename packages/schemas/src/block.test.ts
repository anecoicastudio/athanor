import { describe, expect, it } from 'vitest';
import { blockSchema, blockInput, blockedListItem } from './block.ts';

describe('block schemas', () => {
  it('parses a valid raw block row', () => {
    const row = {
      id: '11111111-1111-1111-1111-111111111111',
      blocker_id: '22222222-2222-2222-2222-222222222222',
      blocked_id: '33333333-3333-3333-3333-333333333333',
      created_at: '2026-06-19T00:00:00Z',
    };
    expect(blockSchema.parse(row)).toEqual(row);
  });

  it('rejects a non-uuid blocked id in the insert input', () => {
    expect(() => blockInput.parse({ blockedId: 'nope' })).toThrow();
  });

  it('parses a blocked-list read model with a null handle', () => {
    const item = {
      id: '11111111-1111-1111-1111-111111111111',
      peerId: '33333333-3333-3333-3333-333333333333',
      peerHandle: null,
      peerDisplayName: null,
      peerAvatarPath: null,
      createdAt: '2026-06-19T00:00:00Z',
    };
    expect(blockedListItem.parse(item)).toEqual(item);
  });
});
