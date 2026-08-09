import { describe, expect, it } from 'vitest';
import { isVersionGateRejection, requestUrlOf } from './version-gate';

const EDGE = 'https://abc.supabase.co/functions/v1/score-engine';
const REST = 'https://abc.supabase.co/rest/v1/profiles?select=*';

describe('isVersionGateRejection', () => {
  it('426 from an edge function is the gate', () => {
    expect(isVersionGateRejection({ status: 426 }, EDGE)).toBe(true);
  });

  it('426 from anywhere else is not the gate — never strand the user on ForceUpdate', () => {
    expect(isVersionGateRejection({ status: 426 }, REST)).toBe(false);
    expect(isVersionGateRejection({ status: 426 }, 'https://example.com/anything')).toBe(false);
  });

  it('an edge-function response with any other status is not the gate', () => {
    for (const status of [200, 201, 400, 401, 403, 404, 425, 427, 429, 500, 503]) {
      expect(isVersionGateRejection({ status }, EDGE)).toBe(false);
    }
  });

  it('matches the storage-style edge URL with a query string', () => {
    expect(isVersionGateRejection({ status: 426 }, `${EDGE}?foo=bar`)).toBe(true);
  });

  it('an empty URL cannot be the gate', () => {
    expect(isVersionGateRejection({ status: 426 }, '')).toBe(false);
  });
});

describe('requestUrlOf', () => {
  it('passes a string input through', () => {
    expect(requestUrlOf(EDGE)).toBe(EDGE);
  });

  it('reads .href off a URL', () => {
    expect(requestUrlOf(new URL(EDGE))).toBe(EDGE);
  });

  it('reads .url off a Request', () => {
    expect(requestUrlOf(new Request(EDGE))).toBe(EDGE);
  });
});

describe('the two composed — the shape supabase.ts calls', () => {
  const gate = (status: number, input: RequestInfo | URL) =>
    isVersionGateRejection({ status }, requestUrlOf(input));

  it('trips for every input form carrying an edge-function 426', () => {
    expect(gate(426, EDGE)).toBe(true);
    expect(gate(426, new URL(EDGE))).toBe(true);
    expect(gate(426, new Request(EDGE))).toBe(true);
  });

  it('stays quiet on a healthy edge call and on a non-edge 426', () => {
    expect(gate(200, new Request(EDGE))).toBe(false);
    expect(gate(426, new Request(REST))).toBe(false);
  });
});
