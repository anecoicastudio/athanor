import { describe, expect, test } from 'vitest';
import { messageInsertSchema, messageKind, messageSchema } from './message';

describe('messageSchema', () => {
  test('parses a user row (snake_case)', () => {
    const row = {
      id: '11111111-1111-1111-1111-111111111111',
      conversation_id: '22222222-2222-2222-2222-222222222222',
      sender_id: '33333333-3333-3333-3333-333333333333',
      kind: 'user',
      prompt_key: null,
      body: 'Ciao!',
      media_url: null,
      created_at: '2026-06-16T10:00:00Z',
      deleted_at: null,
    };
    expect(messageSchema.parse(row).kind).toBe('user');
  });
  test('parses a prompt ice-breaker row (no sender)', () => {
    const row = {
      id: '11111111-1111-1111-1111-111111111111',
      conversation_id: '22222222-2222-2222-2222-222222222222',
      sender_id: null,
      kind: 'prompt',
      prompt_key: 'chat.prompt.who',
      body: null,
      media_url: null,
      created_at: '2026-06-16T10:00:00Z',
      deleted_at: null,
    };
    expect(messageSchema.parse(row).prompt_key).toBe('chat.prompt.who');
  });
});

describe('messageInsertSchema', () => {
  test('trims + requires a non-empty body', () => {
    expect(() =>
      messageInsertSchema.parse({
        conversation_id: '22222222-2222-2222-2222-222222222222',
        sender_id: '33333333-3333-3333-3333-333333333333',
        body: '   ',
      }),
    ).toThrow();
  });
});

describe('messageKind', () => {
  test('is user | system | prompt — the three row kinds, in that order', () => {
    expect(messageKind.options).toEqual(['user', 'system', 'prompt']);
    for (const bad of ['bot', 'media', '']) {
      expect(messageKind.safeParse(bad).success).toBe(false);
    }
  });
});
