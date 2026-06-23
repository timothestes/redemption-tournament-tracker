/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // Server Actions cap request bodies at 1MB by default; Forge card art is
    // validated up to 15MB (validateArtFile / MAX_ART_BYTES), so raise the limit
    // to match (+ multipart overhead). Note: on Vercel, very large uploads may
    // still hit the platform request-body limit — switch art upload to a
    // client-direct-to-Blob flow if that becomes a problem in production.
    serverActions: {
      bodySizeLimit: '16mb',
    },
  },
  webpack: (config) => {
    config.externals = [...(config.externals || []), { canvas: 'canvas' }];
    return config;
  },
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'raw.githubusercontent.com',
        port: '',
        pathname: '/jalstad/RedemptionLackeyCCG/master/RedemptionQuick/sets/setimages/general/**',
      },
      {
        protocol: 'https',
        hostname: '*.public.blob.vercel-storage.com',
      },
    ],
    // Enable optimization for large amounts of images
    minimumCacheTTL: 31536000, // 1 year
    // Allow unoptimized images for API routes
    unoptimized: false,
  },
  outputFileTracingIncludes: {
    '/threshingfloor/outline': ['./app/threshingfloor/outline.html'],
    '/threshingfloor/episodes/[episode]': ['./app/threshingfloor/outline.html'],
  },
};

module.exports = nextConfig;