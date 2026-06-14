import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  transpilePackages: ['@athanor/config', '@athanor/i18n'],
};

export default nextConfig;
