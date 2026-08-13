import { describe, expect, it } from 'vitest';
import { displayParams } from './notif-params';

describe('displayParams', () => {
  it('warn: the reason TOKEN renders as the member-locale report.reason.* label', () => {
    const out = displayParams(
      { template_key: 'notif.tpl.warn', params: { reason: 'harassment' } },
      'it',
    );
    expect(out.reason).toBe('Molestie o comportamento offensivo');
    expect(
      displayParams({ template_key: 'notif.tpl.warn', params: { reason: 'harassment' } }, 'en')
        .reason,
    ).toBe('Harassment or abusive behavior');
  });

  it('an unknown reason token degrades to itself, never to the raw i18n key', () => {
    const out = displayParams(
      { template_key: 'notif.tpl.warn', params: { reason: 'brand_new_category' } },
      'it',
    );
    expect(out.reason).toBe('brand_new_category');
  });

  it('a warn with no reason renders empty, not "undefined"', () => {
    const out = displayParams({ template_key: 'notif.tpl.warn', params: {} }, 'it');
    expect(out.reason).toBe('');
  });

  it('every other template passes its params through untouched', () => {
    const params = { name: 'Sara', reason: 'harassment' };
    expect(displayParams({ template_key: 'notif.tpl.moment', params }, 'it')).toBe(params);
  });
});
