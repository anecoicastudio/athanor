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

// #127 — the fund broadcasts are the only templates that reach every member at once, so an
// unrendered placeholder here is a defect the whole community sees. t() leaves '{pct}' in place
// when the param is absent (#113: degrade, never throw), which is right for the generic case and
// wrong for this one.
describe('displayParams — fund broadcasts always interpolate a number (#127)', () => {
  it('defaults a missing pct/days to 0 rather than leaving the placeholder', () => {
    for (const [template_key, name] of [
      ['notif.tpl.fundMilestone', 'pct'],
      ['notif.tpl.fundAnnounceCountdown', 'days'],
      ['notif.tpl.fundBallotCountdown', 'days'],
    ] as const) {
      expect(displayParams({ template_key, params: {} } as never, 'it')[name]).toBe(0);
      // A non-numeric value is as unusable as an absent one.
      expect(displayParams({ template_key, params: { [name]: 'x' } } as never, 'it')[name]).toBe(0);
    }
  });

  it('passes a real number through untouched', () => {
    expect(
      displayParams({ template_key: 'notif.tpl.fundMilestone', params: { pct: 75 } } as never, 'it')
        .pct,
    ).toBe(75);
  });

  it('leaves the no-param fund templates alone', () => {
    // fundAnnounceLastDay / fundBallotLastDay write the number into the sentence, so they have
    // nothing to interpolate and must not gain a stray key.
    expect(
      displayParams({ template_key: 'notif.tpl.fundBallotLastDay', params: {} } as never, 'it'),
    ).toEqual({});
  });
});

// #800 — an empty name is a member the reader cannot name: an actor who is blocked, banned or
// erased (listNotifications empties the name rather than show the handle the block hides), or
// one who has not chosen a handle yet (#782). t() would render « vuole connettersi con te.»
describe('displayParams — a nameless actor reads as «Qualcuno» (#800)', () => {
  it('an empty name renders the neutral word, in the member locale', () => {
    const n = { template_key: 'notif.tpl.connection' as const, params: { name: '' } };
    expect(displayParams(n, 'it').name).toBe('Qualcuno');
    expect(displayParams(n, 'en').name).toBe('Someone');
  });

  it('keeps the other params, including the actor id', () => {
    const params = { name: '', actor_id: '44444444-4444-4444-8444-444444444444' };
    expect(displayParams({ template_key: 'notif.tpl.helpAccepted', params }, 'it')).toEqual({
      name: 'Qualcuno',
      actor_id: '44444444-4444-4444-8444-444444444444',
    });
  });

  it('a template with no name param is left alone', () => {
    const params = {};
    expect(displayParams({ template_key: 'notif.tpl.gdprExport', params }, 'it')).toBe(params);
  });
});
