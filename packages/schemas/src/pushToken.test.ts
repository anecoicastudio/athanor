import { describe, expect, it } from 'vitest';
import { pushData, pushTokenInsertSchema, pushTokenSchema } from './pushToken';

describe('pushTokenSchema', () => {
  it('parses a valid row', () => {
    const row = {
      id: '11111111-1111-1111-1111-111111111111',
      profileId: '22222222-2222-2222-2222-222222222222',
      token: 'ExponentPushToken[abc123]',
      platform: 'ios',
      deviceId: null,
      createdAt: '2026-06-17T00:00:00.000Z',
      updatedAt: '2026-06-17T00:00:00.000Z',
    };
    expect(pushTokenSchema.parse(row).platform).toBe('ios');
  });

  it('rejects an invalid platform', () => {
    expect(() =>
      pushTokenInsertSchema.parse({ profileId: 'x', token: 't', platform: 'web' }),
    ).toThrow();
  });

  it('rejects an over-long token', () => {
    expect(() =>
      pushTokenInsertSchema.parse({
        profileId: '22222222-2222-2222-2222-222222222222',
        token: 'x'.repeat(513),
        platform: 'ios',
      }),
    ).toThrow();
  });
});

describe('pushData', () => {
  it('accepts the moment deep-link payload', () => {
    expect(pushData.parse({ type: 'moment', route: 'momenti', entity_ref: 'abc' }).type).toBe(
      'moment',
    );
  });
  it('accepts the message deep-link payload', () => {
    expect(pushData.parse({ type: 'message', route: 'chat', entity_ref: 'c1' }).type).toBe(
      'message',
    );
  });
  it('rejects an unknown type', () => {
    expect(() => pushData.parse({ type: 'spam', route: 'x', entity_ref: 'y' })).toThrow();
  });
});
