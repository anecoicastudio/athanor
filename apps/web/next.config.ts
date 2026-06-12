import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  transpilePackages: ['@kaira/api', '@kaira/config', '@kaira/core', '@kaira/i18n', '@kaira/schemas'],
};

export default nextConfig;
