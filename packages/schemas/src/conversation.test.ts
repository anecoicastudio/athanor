import { describe, expect, test } from 'vitest';
import { conversationListItem, conversationPeerRow } from './conversation';

describe('conversationListItem', () => {
  test('parses the camelCase read-model', () => {
    const item = conversationListItem.parse({
      id: '11111111-1111-1111-1111-111111111111',
      peerId: '22222222-2222-2222-2222-222222222222',
      peerHandle: 'bob',
      peerDisplayName: 'Bob Bianchi',
      peerAvatarPath: 'b/b.jpg',
      lastMessageAt: '2026-06-16T10:00:00Z',
      lastMessagePreview: 'Ciao!',
    });
    expect(item.peerHandle).toBe('bob');
  });
});

// The two-embed wire shape supabase-js cannot infer — this schema is what types the row, so
// its key list and the embed's are asserted as literals rather than trusted.
describe('conversationPeerRow', () => {
  const embed = { handle: 'bob', display_name: 'Bob Bianchi', avatar_path: 'b/b.jpg' };
  const row = {
    id: '11111111-1111-1111-1111-111111111111',
    participant_a: '22222222-2222-2222-2222-222222222222',
    participant_b: '33333333-3333-3333-3333-333333333333',
    last_message_at: '2026-06-16T10:00:00Z',
    last_message_preview: 'Ciao!',
    a: embed,
    b: null,
  };

  test('parses a row with one resolved embed and one null embed unchanged', () => {
    expect(conversationPeerRow.parse(row)).toEqual(row);
  });

  test('carries exactly the conversation columns plus the a/b embeds, each the same three fields', () => {
    expect(Object.keys(conversationPeerRow.shape)).toEqual([
      'id',
      'participant_a',
      'participant_b',
      'last_message_at',
      'last_message_preview',
      'a',
      'b',
    ]);
    for (const side of ['a', 'b'] as const) {
      expect(Object.keys(conversationPeerRow.shape[side].unwrap().shape)).toEqual([
        'handle',
        'display_name',
        'avatar_path',
      ]);
    }
  });

  test('rejects an embed missing its handle — a/b share one shape and cannot drift', () => {
    const partial = { display_name: null, avatar_path: null };
    expect(conversationPeerRow.safeParse({ ...row, a: partial }).success).toBe(false);
    expect(conversationPeerRow.safeParse({ ...row, a: null, b: partial }).success).toBe(false);
  });
});
