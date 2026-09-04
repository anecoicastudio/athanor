import { describe, expect, test } from 'vitest';
import { messageInsertSchema, messageKind, messageSchema } from './message.ts';

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
  const CONV = '22222222-2222-2222-2222-222222222222';
  const ME = '33333333-3333-3333-3333-333333333333';
  const MEDIA = `${ME}/${CONV}/44444444-4444-4444-4444-444444444444.jpg`;
  const base = { conversation_id: CONV, sender_id: ME };

  test('trims + requires a non-empty body when body is present', () => {
    expect(() => messageInsertSchema.parse({ ...base, body: '   ' })).toThrow();
    expect(messageInsertSchema.parse({ ...base, body: '  ciao  ' }).body).toBe('ciao');
  });

  test('caps the body at 4000 chars after trim', () => {
    expect(messageInsertSchema.parse({ ...base, body: 'x'.repeat(4000) }).body).toHaveLength(4000);
    expect(() => messageInsertSchema.parse({ ...base, body: 'x'.repeat(4001) })).toThrow();
  });

  test('an image-only message is valid (#155) — media key in the sender/conversation folder', () => {
    expect(messageInsertSchema.parse({ ...base, media_url: MEDIA }).media_url).toBe(MEDIA);
  });

  test('a caption may ride the same message as the image', () => {
    const parsed = messageInsertSchema.parse({ ...base, body: 'guarda', media_url: MEDIA });
    expect(parsed.body).toBe('guarda');
    expect(parsed.media_url).toBe(MEDIA);
  });

  test('a message that is neither text nor image is refused', () => {
    expect(() => messageInsertSchema.parse(base)).toThrow();
  });

  test('media_url is a storage KEY, never free text or a URL (the pre-#155 hole)', () => {
    for (const bad of [
      'https://evil.example/x.jpg',
      `${ME}/${CONV}/x.jpg`, // media segment not a uuid
      `${ME}/${CONV}/44444444-4444-4444-4444-444444444444.png`, // only .jpg survives processImage
      `${ME}/44444444-4444-4444-4444-444444444444.jpg`, // two segments, not three
      MEDIA.toUpperCase(), // uids and Crypto.randomUUID are lowercase; the DB pin is byte-exact
    ]) {
      expect(() => messageInsertSchema.parse({ ...base, media_url: bad })).toThrow();
    }
  });

  test('a key under another member or another conversation is refused before it travels', () => {
    const otherUid = `11111111-1111-1111-1111-111111111111/${CONV}/44444444-4444-4444-4444-444444444444.jpg`;
    const otherConv = `${ME}/11111111-1111-1111-1111-111111111111/44444444-4444-4444-4444-444444444444.jpg`;
    expect(() => messageInsertSchema.parse({ ...base, media_url: otherUid })).toThrow();
    expect(() => messageInsertSchema.parse({ ...base, media_url: otherConv })).toThrow();
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
