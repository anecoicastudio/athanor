import { describe, expect, it } from 'vitest';
import { clientIp } from './client-ip';

const reqWith = (headers: Record<string, string>) =>
  ({
    headers: { get: (k: string) => headers[k.toLowerCase()] ?? null },
  }) as unknown as Request;

describe('clientIp', () => {
  it('takes the FIRST entry of x-forwarded-for — the client, not the proxy', () => {
    // Each hop appends. Taking the last would key every request in a region to one edge node,
    // so real visitors would throttle each other off — the exact failure the per-client budget
    // exists to avoid.
    expect(
      clientIp(reqWith({ 'x-forwarded-for': '203.0.113.7, 70.41.3.18, 150.172.238.178' })),
    ).toBe('203.0.113.7');
  });

  it('prefers cf-connecting-ip over a forged x-forwarded-for', () => {
    // The security-relevant case on Cloudflare. The edge APPENDS the real client to
    // x-forwarded-for, so the leftmost entry is whatever the attacker sent. Reading XFF first
    // would make the throttle key attacker-chosen and undo issue #23; cf-connecting-ip is set
    // by the edge from the terminated connection and cannot be spoofed.
    expect(
      clientIp(
        reqWith({
          'cf-connecting-ip': '198.51.100.4',
          'x-forwarded-for': '203.0.113.7, 198.51.100.4',
        }),
      ),
    ).toBe('198.51.100.4');
  });

  it('lets a blank cf-connecting-ip fall through instead of shadowing the rest', () => {
    expect(clientIp(reqWith({ 'cf-connecting-ip': '', 'x-forwarded-for': '203.0.113.7' }))).toBe(
      '203.0.113.7',
    );
  });

  it('prefers x-vercel-forwarded-for — set from the connection Vercel terminated', () => {
    // The plain header is whatever the caller sent; Vercel's own is derived from the socket, so
    // it is the less forgeable of the two where both exist.
    expect(
      clientIp(
        reqWith({ 'x-vercel-forwarded-for': '198.51.100.4', 'x-forwarded-for': '203.0.113.7' }),
      ),
    ).toBe('198.51.100.4');
  });

  it('trims whitespace and handles a single-entry header', () => {
    expect(clientIp(reqWith({ 'x-forwarded-for': '  203.0.113.7 , 70.41.3.18' }))).toBe(
      '203.0.113.7',
    );
    expect(clientIp(reqWith({ 'x-forwarded-for': '203.0.113.7' }))).toBe('203.0.113.7');
  });

  it('falls back to x-real-ip last', () => {
    expect(clientIp(reqWith({ 'x-real-ip': '198.51.100.4' }))).toBe('198.51.100.4');
  });

  it('collapses to one shared key when no header is present — stricter, never absent', () => {
    // The important direction: a proxy that strips these must make the budget tighter, not turn
    // it off. Every anonymous caller then shares the `unknown` bucket.
    expect(clientIp(reqWith({}))).toBe('unknown');
  });

  it('does not treat an empty or comma-only header as an address', () => {
    expect(clientIp(reqWith({ 'x-forwarded-for': '' }))).toBe('unknown');
    expect(clientIp(reqWith({ 'x-forwarded-for': ' , ' }))).toBe('unknown');
    expect(clientIp(reqWith({ 'x-real-ip': '   ' }))).toBe('unknown');
  });

  it('skips an empty higher-priority header rather than stopping at it', () => {
    // A present-but-blank x-vercel-forwarded-for must not shadow a usable x-forwarded-for.
    expect(
      clientIp(reqWith({ 'x-vercel-forwarded-for': '', 'x-forwarded-for': '203.0.113.7' })),
    ).toBe('203.0.113.7');
  });

  it('survives a Request with no headers object at all', () => {
    expect(clientIp({} as Request)).toBe('unknown');
  });
});
