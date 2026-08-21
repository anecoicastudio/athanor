import { describe, expect, test } from 'vitest';
import {
  connectionListItem,
  connectionRequestListItem,
  connectionRequestRow,
  connectionState,
} from './connection';

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

// The wire shape the aliased embed defeats supabase-js on — this schema is the row's type, so
// its key list is asserted as a literal rather than trusted.
describe('connectionRequestRow', () => {
  const row = {
    id: uuid,
    requester_id: uuid,
    created_at: '2026-07-01T00:00:00Z',
    requester: { handle: 'bob', display_name: 'Bob Bianchi', avatar_path: 'b/b.jpg' },
  };

  test('parses a request row with its requester embed unchanged', () => {
    expect(connectionRequestRow.parse(row)).toEqual(row);
  });

  test('carries exactly id, requester_id, created_at and the three-field requester embed', () => {
    expect(Object.keys(connectionRequestRow.shape)).toEqual([
      'id',
      'requester_id',
      'created_at',
      'requester',
    ]);
    expect(Object.keys(connectionRequestRow.shape.requester.unwrap().shape)).toEqual([
      'handle',
      'display_name',
      'avatar_path',
    ]);
  });

  test('accepts a null embed (requester not visible) and rejects an embed missing its handle', () => {
    expect(connectionRequestRow.parse({ ...row, requester: null }).requester).toBeNull();
    expect(
      connectionRequestRow.safeParse({
        ...row,
        requester: { display_name: null, avatar_path: null },
      }).success,
    ).toBe(false);
  });
});
