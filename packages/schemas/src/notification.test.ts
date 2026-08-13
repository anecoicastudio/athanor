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

  it('exposes the 8 canonical types', () => {
    // 7 from M9 + 'moderation' (#313 warn verdicts)
    expect(NOTIFICATION_TYPES).toHaveLength(8);
    expect(NOTIFICATION_TYPES).toContain('moderation');
  });

  it('admits the warn template key (#313)', () => {
    const row = {
      id: '11111111-1111-1111-1111-111111111111',
      recipient_id: '22222222-2222-2222-2222-222222222222',
      type: 'moderation',
      template_key: 'notif.tpl.warn',
      params: { reason: 'harassment' },
      entity_ref: { kind: 'report', id: '33333333-3333-3333-3333-333333333333' },
      read_at: null,
      created_at: '2026-08-13T10:00:00Z',
    };
    const parsed = notificationSchema.parse(row);
    expect(parsed.type).toBe('moderation');
    expect(parsed.template_key).toBe('notif.tpl.warn');
  });

  // #113: an unknown template_key (old client, newer server — e.g. after #125) must degrade
  // one row to the generic template, never fail the whole page parse in listNotifications.
  it('degrades an unknown template_key to the generic template instead of rejecting', () => {
    const row = {
      id: '11111111-1111-1111-1111-111111111111',
      recipient_id: '22222222-2222-2222-2222-222222222222',
      type: 'moment',
      template_key: 'notif.tpl.somethingNewer',
      params: {},
      entity_ref: null,
      read_at: null,
      created_at: '2026-06-20T10:00:00Z',
    };
    expect(notificationSchema.parse(row).template_key).toBe('notif.tpl.generic');
  });

  it('passes a known template_key through unchanged', () => {
    const row = {
      id: '11111111-1111-1111-1111-111111111111',
      recipient_id: '22222222-2222-2222-2222-222222222222',
      type: 'connection',
      template_key: 'notif.tpl.connectionAccepted',
      params: { name: 'Marco' },
      entity_ref: null,
      read_at: null,
      created_at: '2026-06-20T10:00:00Z',
    };
    expect(notificationSchema.parse(row).template_key).toBe('notif.tpl.connectionAccepted');
  });

  // #125: the help-status producers write these two keys; they must not degrade to generic.
  it('admits the help-status template keys', () => {
    for (const key of ['notif.tpl.helpAccepted', 'notif.tpl.helpConfirmed']) {
      const row = {
        id: '11111111-1111-1111-1111-111111111111',
        recipient_id: '22222222-2222-2222-2222-222222222222',
        type: 'dreamMilestone',
        template_key: key,
        params: { name: 'Marco' },
        entity_ref: { kind: 'milestone_help', id: 'abc' },
        read_at: null,
        created_at: '2026-06-20T10:00:00Z',
      };
      expect(notificationSchema.parse(row).template_key).toBe(key);
    }
  });
});
