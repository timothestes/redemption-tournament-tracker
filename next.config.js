// landofredemption.com is being pointed at this app as an alias domain (see
// docs/superpowers... project_lor_siteground_shutdown memory) with
// redemptionccg.app staying canonical — Vercel's domain settings 301 the
// alias to canonical, preserving path + query, so these rules only need to
// run once, on the canonical host.
const blobBase = process.env.NEXT_PUBLIC_BLOB_BASE_URL;

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
    '/api/v1/generate-decklist': ['./assets/decksheets/**'],
    '/api/v1/generate-decklist-image': ['./assets/decksheets/fonts/**'],
  },
  async redirects() {
    return [
      // WordPress media -> the Blob mirror created for the article import
      // (same `wp/wp-content/uploads/...` scheme; see scripts/lib/wxr/urls.ts
      // and scripts/mirror-lor-files.ts). Individual posts' bodies were
      // already rewritten to these URLs at import time — this rule covers
      // links from outside the tracker (search results, other sites).
      ...(blobBase
        ? [
            {
              source: '/wp-content/uploads/:path*',
              destination: `${blobBase}/wp/wp-content/uploads/:path*`,
              permanent: true,
            },
            {
              source: '/podcasts/:path*',
              destination: `${blobBase}/wp/podcasts/:path*`,
              permanent: true,
            },
          ]
        : []),
      // WordPress pages that now live at a different tracker path. Posts
      // (`/<slug>/`) are handled by app/[wpSlug]/page.tsx instead, since
      // that mapping is per-post data, not a fixed rule.
      { source: '/feed', destination: '/articles/feed.xml', permanent: true },
      { source: '/feed/', destination: '/articles/feed.xml', permanent: true },
      { source: '/our-sponsors', destination: '/sponsors', permanent: true },
      { source: '/our-sponsors/', destination: '/sponsors', permanent: true },
      { source: '/paragon', destination: '/resources#paragon', permanent: true },
      { source: '/paragon/', destination: '/resources#paragon', permanent: true },
      { source: '/rankings', destination: '/tournaments/rnrs-points', permanent: true },
      { source: '/rankings/', destination: '/tournaments/rnrs-points', permanent: true },
    ];
  },
};

module.exports = nextConfig;