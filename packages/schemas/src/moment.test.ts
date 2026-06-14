import { describe, expect, it } from 'vitest';
import { momentInsertSchema } from './moment';

describe('momentInsertSchema', () => {
  it('accepts photo with caption', () => {
    expect(() =>
      momentInsertSchema.parse({
        owner_id: '00000000-0000-0000-0000-000000000001',
        kind: 'photo',
        media_path: 'uid/m.jpg',
        caption: 'ok',
      }),
    ).not.toThrow();
  });
  it('rejects caption over 280 chars', () => {
    expect(() =>
      momentInsertSchema.parse({
        owner_id: '00000000-0000-0000-0000-000000000001',
        kind: 'photo',
        media_path: 'uid/m.jpg',
        caption: 'x'.repeat(281),
      }),
    ).toThrow();
  });
});
