import type { NextConfig } from 'next';
import { SITE_URL } from './lib/site';

const CANONICAL_HOST = new URL(SITE_URL).host;

const nextConfig: NextConfig = {
  // All three <Image> sources are local PNGs (~190 KB total) served straight off
  // static assets. Keeping the optimizer would mean standing up another billed
  // image pipeline on the host to save ~100 KB.
  images: { unoptimized: true },
  // The OG-card TTFs are read with fs at BUILD time only (the Worker branch of
  // app/[handle]/opengraph-image.tsx redirects instead of rendering), but file
  // tracing sees the readFile and would copy ~170 KB of fonts into the server
  // function — dead weight against the free plan's 3 MiB gzip Worker cap.
  outputFileTracingExcludes: { '*': ['./assets/og-fonts/**'] },
  // All five workspace deps export raw TS (`"." → ./src/index.ts`) — list them all;
  // the build compiled the missing three implicitly, which is a Next-upgrade hazard.
  transpilePackages: [
    '@athanor/api',
    '@athanor/config',
    '@athanor/core',
    '@athanor/i18n',
    '@athanor/schemas',
  ],
  // Universal Links / App Links association files. Apple + Google fetch these at the
  // canonical `/.well-known/*` paths and require a direct 200 with `application/json`
  // and NO redirect. Rewrites (not redirects) preserve the URL while serving the route
  // handlers, sidestepping Next's dot-folder route-segment ambiguity. See P1.3.
  // Every host that is not the canonical one — the Worker's `*.workers.dev` route, the
  // bare apex — 308s to `SITE_URL`, path and query intact. Host-conditioned so the
  // canonical host itself never matches — the value is anchored by hand because Next
  // anchors `has.value` and OpenNext (`@opennextjs/aws` matcher.js) does NOT, so an
  // unanchored `athanor\.world` would match inside `www.athanor.world` and loop in
  // production while passing every local check. Guarded so a build whose SITE_URL is
  // still a `workers.dev` host (a validation deploy before the domain is attached)
  // cannot loop either. `lib/redirects.test.ts` pins all three properties.
  // AASA/assetlinks are exempt on purpose: Apple and Google refuse them over a redirect,
  // and a store build that still claims the old host must keep verifying until it is gone.
  async redirects() {
    if (CANONICAL_HOST.endsWith('.workers.dev')) return [];
    return [
      {
        source: '/:path((?!\\.well-known/).*)',
        has: [{ type: 'host', value: '^(.+\\.workers\\.dev|athanor\\.world)$' }],
        // `:path(.*)`, not `:path`: Next compiles destinations with path-to-regexp
        // validation OFF, OpenNext compiles them ON, so a bare `:path` throws (500) for
        // `/` and for any multi-segment path on the redirected host. `lib/redirects.test.ts`
        // drives both compilers.
        destination: `https://${CANONICAL_HOST}/:path(.*)`,
        permanent: true,
      },
    ];
  },
  async rewrites() {
    return [
      {
        source: '/.well-known/apple-app-site-association',
        destination: '/api/well-known/apple-app-site-association',
      },
      {
        source: '/.well-known/assetlinks.json',
        destination: '/api/well-known/assetlinks',
      },
      // Universal-link fallback (#268): every /post/{id} serves the one static
      // invitation shell. A rewrite, not a `[id]` segment — the copy is
      // id-independent, and a dynamic segment would cache one permanent KV
      // entry per arbitrary string instead of exactly one for the whole path.
      {
        source: '/post/:id',
        destination: '/post',
      },
    ];
  },
};

export default nextConfig;
