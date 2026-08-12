import { describe, expect, test } from 'vitest';
import { connectionListItem, connectionRequestListItem, connectionState } from './connection';

const uuid = '2b7e6a1e-9c4d-4f4a-9a3b-1c2d3e4f5a6b';

describe('read models + enums', () => {
  test('list items accept nullable peerHandle', () => {
    const item = {
      id: uuid,
      peerId: uuid,
      peerHandle: null,
      peerDisplayName: null,
      peerAvatarPath: null,
      createdAt: '2026-07-01T00:00:00Z',
    };
    expect(connectionRequestListItem.parse(item).peerHandle).toBeNull();
    expect(connectionListItem.parse(item).peerHandle).toBeNull();
  });

  test('button-state enum is closed', () => {
    expect(connectionState.options).toEqual(['none', 'pending-out', 'pending-in', 'connected']);
    expect(connectionState.safeParse('blocked').success).toBe(false);
  });
});
