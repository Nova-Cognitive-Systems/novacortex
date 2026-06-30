import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: 'standalone',
  serverExternalPackages: [],
  experimental: {
    serverActions: {
      bodySizeLimit: '10mb',
    },
  },
  turbopack: {
    root: '../..',
  },
  allowedDevOrigins: ['192.168.42.22', '192.168.*.*', '10.*.*.*'],
};

export default nextConfig;
