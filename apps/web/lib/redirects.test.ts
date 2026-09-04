import { compile, match } from 'path-to-regexp';
import { describe, expect, it, vi } from 'vitest';
import nextConfig from '../next.config';

/**
 * The host redirect in `next.config.ts` runs on two routers with different rules:
 *   Next    — anchors `has.value` (`^…$`) and compiles the destination with validation OFF
 *   OpenNext — `@opennextjs/aws` matcher.js: `new RegExp(value).test(host)` UNanchored, and
 *              `compile(destination)` with path-to-regexp validation ON
 * Every local check runs the first; production runs the second. Each property below is one
 * that passed Next and failed OpenNext at least once during #471, so they are pinned here,
 * against path-to-regexp@6.3.0 — the version `@opennextjs/aws` depends on.
 */
async function redirect() {
  const list = await nextConfig.redirects!();
  expect(list).toHaveLength(1);
  return list[0];
}

const CANONICAL = 'www.athanor.world';

describe('host redirect', () => {
  it('matches every foreign host and never the canonical one, under BOTH matchers', async () => {
    const [has] = (await redirect()).has!;
    const opennext = new RegExp(has.value!); // unanchored, as OpenNext runs it
    const next = new RegExp(`^${has.value}$`); // as Next runs it
    for (const host of ['www.athanor.workers.dev', 'www.anecoica.workers.dev', 'athanor.world']) {
      expect(opennext.test(host), host).toBe(true);
      expect(next.test(host), host).toBe(true);
    }
    for (const host of [CANONICAL, 'xathanor.world', 'athanor.world.evil']) {
      expect(opennext.test(host), host).toBe(false);
      expect(next.test(host), host).toBe(false);
    }
  });

  it('exempts /.well-known/* — Apple and Google refuse the association files over a redirect', async () => {
    const { source } = await redirect();
    const m = match(source, { decode: decodeURIComponent });
    expect(m('/.well-known/apple-app-site-association')).toBe(false);
    expect(m('/.well-known/assetlinks.json')).toBe(false);
    for (const p of ['/', '/terms', '/app/payout/return', '/@sole', '/event/abc']) {
      expect(m(p), p).not.toBe(false);
    }
  });

  it('compiles the destination for every matched path with validation ON, as OpenNext does', async () => {
    const { source, destination, permanent } = await redirect();
    expect(permanent).toBe(true);
    const m = match(source, { decode: decodeURIComponent });
    const toPath = compile(destination.replace(`https://${CANONICAL}`, ''));
    for (const [p, want] of [
      ['/', '/'],
      ['/terms', '/terms'],
      ['/app/payout/return', '/app/payout/return'],
      ['/@sole', '/@sole'],
    ] as const) {
      const hit = m(p);
      expect(hit, p).not.toBe(false);
      expect(toPath((hit as { params: object }).params), p).toBe(want);
    }
  });

  it('is absent when SITE_URL itself is a workers.dev host, so a validation deploy cannot loop', async () => {
    vi.resetModules();
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://www.anecoica.workers.dev');
    try {
      const fresh = (await import('../next.config')).default;
      expect(await fresh.redirects!()).toEqual([]);
    } finally {
      vi.unstubAllEnvs();
      vi.resetModules();
    }
  });
});
