import { describe, expect, test } from 'vitest';
import { conversationSchema, conversationListItem } from './conversation';

describe('conversationSchema', () => {
  test('parses a row (snake_case, non-null last_message_at)', () => {
    const row = {
      id: '11111111-1111-1111-1111-111111111111',
      participant_a: '11111111-1111-1111-1111-111111111111',
      participant_b: '22222222-2222-2222-2222-222222222222',
      created_from: 'momento',
      last_message_at: '2026-06-16T10:00:00Z',
      last_message_preview: null,
      created_at: '2026-06-16T10:00:00Z',
      updated_at: '2026-06-16T10:00:00Z',
    };
    expect(conversationSchema.parse(row).created_from).toBe('momento');
  });
  test('rejects an invalid source', () => {
    expect(() => conversationSchema.parse({ created_from: 'sms' })).toThrow();
  });
});

describe('conversationListItem', () => {
  test('parses the camelCase read-model', () => {
    const item = conversationListItem.parse({
      id: '11111111-1111-1111-1111-111111111111',
      peerId: '22222222-2222-2222-2222-222222222222',
      peerHandle: 'bob',
      lastMessageAt: '2026-06-16T10:00:00Z',
      lastMessagePreview: 'Ciao!',
    });
    expect(item.peerHandle).toBe('bob');
  });
});
