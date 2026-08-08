import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
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
    ];
  },
};

export default nextConfig;
