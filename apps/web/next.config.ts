import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  transpilePackages: ['@auria/config', '@auria/i18n'],
};

export default nextConfig;
