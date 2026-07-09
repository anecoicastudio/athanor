import { describe, expect, test } from 'vitest';
import {
  connectionListItem,
  connectionRequestListItem,
  connectionRequestSchema,
  connectionSchema,
  connectionState,
  connectionStatus,
} from './connection';

const uuid = '2b7e6a1e-9c4d-4f4a-9a3b-1c2d3e4f5a6b';

describe('connectionRequestSchema', () => {
  const row = {
    id: uuid,
    requester_id: uuid,
    addressee_id: uuid,
    status: 'pending',
    responded_at: null,
    created_at: '2026-07-01T00:00:00+00:00',
    updated_at: '2026-07-01T00:00:00+00:00',
  };

  test('parses a raw pending row; responded_at nullable', () => {
    expect(connectionRequestSchema.parse(row)).toEqual(row);
    expect(
      connectionRequestSchema.parse({ ...row, status: 'accepted', responded_at: row.created_at })
        .responded_at,
    ).toBe(row.created_at);
  });

  test('rejects unknown status', () => {
    expect(connectionRequestSchema.safeParse({ ...row, status: 'blocked' }).success).toBe(false);
  });
});

describe('connectionSchema', () => {
  test('parses an established pair; source_request_id nullable', () => {
    const row = {
      id: uuid,
      profile_a: uuid,
      profile_b: uuid,
      source_request_id: null,
      created_at: '2026-07-01T00:00:00+00:00',
    };
    expect(connectionSchema.parse(row)).toEqual(row);
  });
});

describe('read models + enums', () => {
  test('list items accept nullable peerHandle', () => {
    const item = { id: uuid, peerId: uuid, peerHandle: null, createdAt: '2026-07-01T00:00:00Z' };
    expect(connectionRequestListItem.parse(item).peerHandle).toBeNull();
    expect(connectionListItem.parse(item).peerHandle).toBeNull();
  });

  test('status and button-state enums are closed', () => {
    expect(connectionStatus.options).toEqual(['pending', 'accepted', 'declined']);
    expect(connectionState.options).toEqual(['none', 'pending-out', 'pending-in', 'connected']);
    expect(connectionState.safeParse('blocked').success).toBe(false);
  });
});
