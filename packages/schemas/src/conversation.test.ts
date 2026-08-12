import { describe, expect, test } from 'vitest';
import { conversationListItem } from './conversation';

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
