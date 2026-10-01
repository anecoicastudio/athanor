import { describe, expect, it } from 'vitest';
import { LOCATION_CONSENT_DEFAULT, locationConsentOf } from './location-consent';

/**
 * #783: «Localizzazione approssimativa» gates every device-position read. `unknown` is its own
 * answer — the consent records have not loaded — and callers read no position on it, so a slow
 * query can never let a member who switched it OFF be located.
 */
describe('locationConsentOf', () => {
  it('is unknown until the consent records have loaded', () => {
    expect(locationConsentOf(undefined)).toBe('unknown');
  });

  it('is on when the member never touched the switch (the default)', () => {
    expect(LOCATION_CONSENT_DEFAULT).toBe(true);
    expect(locationConsentOf([])).toBe('on');
  });

  it('is off when the member switched it off', () => {
    expect(locationConsentOf([{ kind: 'location_approx', granted: false }])).toBe('off');
  });

  it('is on when the member switched it back on', () => {
    expect(locationConsentOf([{ kind: 'location_approx', granted: true }])).toBe('on');
  });

  it('reads only the location row, never another consent', () => {
    expect(locationConsentOf([{ kind: 'analytics', granted: false }])).toBe('on');
    expect(
      locationConsentOf([
        { kind: 'analytics', granted: true },
        { kind: 'location_approx', granted: false },
      ]),
    ).toBe('off');
  });
});
