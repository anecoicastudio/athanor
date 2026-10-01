import { generateKeyPairSync, verify } from 'node:crypto';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * `scripts/apple-client-secret.mjs` mints the client secret Supabase's Apple provider needs for
 * the browser OAuth flow (#79). Apple accepts it for at most six months, so the script is run
 * again at every rotation — `docs/RELEASE-RUNBOOK.md` §6.1 carries the due date.
 *
 * Tested here for the reason `deploy-check.test.ts` gives: a repo-root operator script belongs
 * to no workspace, this package is the closest owner (the hosted Supabase projects), and
 * `packages/api/turbo.json` declares the script as a `$TURBO_ROOT$` input.
 *
 * Only the pure half is exercised: signing and argument resolution. Reading the `.p8` and the
 * `pbcopy` hand-off are I/O, and the key they would need is exactly what must never exist in a
 * test fixture. Every key below is generated per run and discarded.
 */
const SCRIPT = (() => {
  let dir = fileURLToPath(new URL('.', import.meta.url).href);
  for (;;) {
    const candidate = join(dir, 'scripts', 'apple-client-secret.mjs');
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) throw new Error('no scripts/apple-client-secret.mjs above this test');
    dir = parent;
  }
})();

interface BuildInput {
  privateKeyPem: string;
  keyId: string;
  teamId: string;
  clientId: string;
  now: Date;
  days?: number;
}

interface AppleClientSecret {
  APPLE_AUDIENCE: string;
  MAX_DAYS: number;
  buildAppleClientSecret: (input: BuildInput) => { token: string; expiresAt: Date };
  resolveOptions: (
    argv: string[],
    env: Record<string, string | undefined>,
  ) => { keyPath: string; keyId: string; teamId: string; clientId: string; days: number };
}

const mod = (await import(pathToFileURL(SCRIPT).href)) as AppleClientSecret;
const { APPLE_AUDIENCE, MAX_DAYS, buildAppleClientSecret, resolveOptions } = mod;

const p256 = () => generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const pem = (k: ReturnType<typeof p256>['privateKey']) =>
  k.export({ type: 'pkcs8', format: 'pem' }).toString();

const decode = (part: string): unknown =>
  JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));

const NOW = new Date('2026-09-24T10:00:00Z');
const IAT = Math.floor(NOW.getTime() / 1000);
const BASE = {
  keyId: 'ABCDE12345',
  teamId: 'V299S78WM5',
  clientId: 'world.athanor.signin',
  now: NOW,
};

describe('buildAppleClientSecret', () => {
  it('writes the header and claims Apple documents', () => {
    const { privateKey } = p256();
    const { token } = buildAppleClientSecret({ ...BASE, privateKeyPem: pem(privateKey) });
    const [header, payload] = token.split('.');
    expect(decode(header!)).toEqual({ alg: 'ES256', kid: 'ABCDE12345' });
    expect(decode(payload!)).toEqual({
      iss: 'V299S78WM5',
      iat: IAT,
      exp: IAT + MAX_DAYS * 86_400,
      aud: 'https://appleid.apple.com',
      sub: 'world.athanor.signin',
    });
    expect(APPLE_AUDIENCE).toBe('https://appleid.apple.com');
  });

  it('stays inside Apple’s six-month ceiling (15777000 s)', () => {
    expect(MAX_DAYS * 86_400).toBeLessThanOrEqual(15_777_000);
  });

  it('returns the expiry it signed, for the runbook', () => {
    const { privateKey } = p256();
    const { token, expiresAt } = buildAppleClientSecret({
      ...BASE,
      privateKeyPem: pem(privateKey),
      days: 30,
    });
    const claims = decode(token.split('.')[1]!) as { exp: number };
    expect(claims.exp).toBe(IAT + 30 * 86_400);
    expect(expiresAt.getTime()).toBe(claims.exp * 1000);
  });

  it('signs in JOSE form (64-byte r||s), not DER — Apple rejects a DER signature', () => {
    const { privateKey, publicKey } = p256();
    const { token } = buildAppleClientSecret({ ...BASE, privateKeyPem: pem(privateKey) });
    const [header, payload, signature] = token.split('.');
    const sig = Buffer.from(signature!, 'base64url');
    expect(sig).toHaveLength(64);
    const ok = verify(
      'sha256',
      Buffer.from(`${header}.${payload}`),
      { key: publicKey, dsaEncoding: 'ieee-p1363' },
      sig,
    );
    expect(ok).toBe(true);
  });

  it.each([0, -1, MAX_DAYS + 1, 1.5])('refuses a lifetime of %s days', (days) => {
    const { privateKey } = p256();
    expect(() => buildAppleClientSecret({ ...BASE, privateKeyPem: pem(privateKey), days })).toThrow(
      /days/,
    );
  });

  it('refuses a key that is not P-256 — ES256 is the only algorithm Apple takes', () => {
    const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'secp384r1' });
    expect(() =>
      buildAppleClientSecret({
        ...BASE,
        privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
      }),
    ).toThrow(/P-256/);
  });

  it.each([
    ['keyId', 'short'],
    ['keyId', 'abcde12345'],
    ['teamId', 'V299S78WM'],
    ['clientId', ''],
  ])('refuses a malformed %s (%j)', (field, value) => {
    const { privateKey } = p256();
    expect(() =>
      buildAppleClientSecret({ ...BASE, privateKeyPem: pem(privateKey), [field]: value }),
    ).toThrow(new RegExp(field));
  });
});

describe('resolveOptions', () => {
  it('reads flags, with the Team ID defaulting to Athanor’s', () => {
    expect(
      resolveOptions(
        ['--key', '/k/AuthKey_ABCDE12345.p8', '--key-id', 'ABCDE12345', '--client-id', 'x.y'],
        {},
      ),
    ).toEqual({
      keyPath: '/k/AuthKey_ABCDE12345.p8',
      keyId: 'ABCDE12345',
      teamId: 'V299S78WM5',
      clientId: 'x.y',
      days: MAX_DAYS,
    });
  });

  it('falls back to APPLE_* env vars, and a flag beats the env', () => {
    const env = {
      APPLE_KEY_PATH: '/env/key.p8',
      APPLE_KEY_ID: 'ENVKEY1234',
      APPLE_TEAM_ID: 'ENVTEAM123',
      APPLE_SERVICES_ID: 'env.services',
    };
    expect(resolveOptions(['--days', '90'], env)).toEqual({
      keyPath: '/env/key.p8',
      keyId: 'ENVKEY1234',
      teamId: 'ENVTEAM123',
      clientId: 'env.services',
      days: 90,
    });
    expect(resolveOptions(['--key-id', 'FLAGKEY123'], env).keyId).toBe('FLAGKEY123');
  });

  it('names every missing input at once', () => {
    expect(() => resolveOptions([], {})).toThrow(/--key.*--key-id.*--client-id/s);
  });

  it('refuses an unknown flag rather than ignoring a typo', () => {
    expect(() => resolveOptions(['--keyid', 'X'], {})).toThrow(/--keyid/);
  });
});
