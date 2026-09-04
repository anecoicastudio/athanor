import { describe, expect, it } from 'vitest';
import { pushPlatformSchema, pushTokenInsertSchema } from './pushToken.ts';

const valid = {
  profile_id: '11111111-1111-1111-1111-111111111111',
  token: 'ExponentPushToken[abc123]',
  platform: 'ios' as const,
  device_id: null,
};

describe('pushTokenInsertSchema', () => {
  it('parses a valid upsert payload; device_id may be null or absent (column has no default)', () => {
    expect(pushTokenInsertSchema.parse(valid)).toEqual(valid);
    expect(pushTokenInsertSchema.parse({ ...valid, device_id: 'd1' }).device_id).toBe('d1');
    const { device_id: _omitted, ...withoutDevice } = valid;
    expect(pushTokenInsertSchema.parse(withoutDevice).device_id).toBeUndefined();
  });

  it('bounds token to the CHECK constraint (1–512 chars)', () => {
    expect(pushTokenInsertSchema.parse({ ...valid, token: 'x'.repeat(512) }).token).toHaveLength(
      512,
    );
    expect(() => pushTokenInsertSchema.parse({ ...valid, token: 'x'.repeat(513) })).toThrow();
    expect(() => pushTokenInsertSchema.parse({ ...valid, token: '' })).toThrow();
  });

  it('rejects a non-uuid profile_id and an unknown platform', () => {
    expect(() => pushTokenInsertSchema.parse({ ...valid, profile_id: 'me' })).toThrow();
    expect(() => pushTokenInsertSchema.parse({ ...valid, platform: 'web' })).toThrow();
  });

  it('the platform enum is closed (mirrors the CHECK)', () => {
    expect(pushPlatformSchema.options).toEqual(['ios', 'android']);
  });
});
