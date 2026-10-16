import type { NextConfig } from 'next';

const config: NextConfig = {
  reactStrictMode: true,
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: `${process.env.API_INTERNAL_URL ?? 'http://localhost:3001'}/api/:path*`,
      },
    ];
  },
};

export default config;
