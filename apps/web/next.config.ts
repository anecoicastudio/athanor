import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  transpilePackages: ['@athanor/config', '@athanor/i18n'],
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
