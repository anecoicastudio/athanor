import { describe, it, expect } from 'vitest';
import { notificationSchema, NOTIFICATION_TYPES } from './notification';

describe('notificationSchema', () => {
  it('parses a valid notification row', () => {
    const row = {
      id: '11111111-1111-1111-1111-111111111111',
      recipient_id: '22222222-2222-2222-2222-222222222222',
      type: 'moment',
      template_key: 'notif.tpl.moment',
      params: { name: 'Marco' },
      entity_ref: { kind: 'momento', id: 'abc' },
      read_at: null,
      created_at: '2026-06-20T10:00:00Z',
    };
    expect(notificationSchema.parse(row).type).toBe('moment');
  });

  it('rejects an unknown type', () => {
    expect(() =>
      notificationSchema.parse({
        id: '11111111-1111-1111-1111-111111111111',
        recipient_id: '22222222-2222-2222-2222-222222222222',
        type: 'spam',
        template_key: 'x',
        params: {},
        entity_ref: null,
        read_at: null,
        created_at: '2026-06-20T10:00:00Z',
      }),
    ).toThrow();
  });

  it('exposes the 7 canonical types', () => {
    expect(NOTIFICATION_TYPES).toHaveLength(7);
  });
});
