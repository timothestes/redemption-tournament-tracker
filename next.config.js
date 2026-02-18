/** @type {import('next').NextConfig} */
const nextConfig = {
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
};

module.exports = nextConfig;