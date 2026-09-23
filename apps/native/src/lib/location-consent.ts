import type { Consent } from '@athanor/schemas';

/**
 * «Localizzazione approssimativa» with no stored row (#783). ON: the member has not said otherwise,
 * and the switch on Trust shows the same fallback — both read this constant, so the screen can
 * never show one state while the app acts on the other.
 */
export const LOCATION_CONSENT_DEFAULT = true;

/**
 * `unknown` while the consent records are still loading. Callers read no device position on it:
 * the switch is the gate, and a gate that opened before it knew its own state would not be one.
 */
export type LocationConsent = 'on' | 'off' | 'unknown';

export function locationConsentOf(
  consents: readonly Pick<Consent, 'kind' | 'granted'>[] | undefined,
): LocationConsent {
  if (!consents) return 'unknown';
  const granted =
    consents.find((c) => c.kind === 'location_approx')?.granted ?? LOCATION_CONSENT_DEFAULT;
  return granted ? 'on' : 'off';
}
