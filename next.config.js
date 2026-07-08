/** @type {import('next').NextConfig} */
const nextConfig = {
  // `next build` and `next dev` share .next/ — running a build while the dev
  // server is up corrupts the dev server's cache (missing vendor-chunks, 500s).
  // Verification builds should run in a separate dir:
  //   NEXT_DIST_DIR=.next-build npm run build
  distDir: process.env.NEXT_DIST_DIR || '.next',
  // @vercel/blob 2.4.x pulls in Node-only deps (@vercel/oidc, undici) that read
  // fs/path and have no react-server export condition, so webpack bundling them
  // into the RSC server bundle throws at load. Externalize so Next require()s the
  // package at runtime (which works) instead of bundling it.
  serverExternalPackages: ['@vercel/blob'],
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