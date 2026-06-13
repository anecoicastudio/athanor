import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  transpilePackages: ['@auria/api', '@auria/config', '@auria/core', '@auria/i18n', '@auria/schemas'],
};

export default nextConfig;
