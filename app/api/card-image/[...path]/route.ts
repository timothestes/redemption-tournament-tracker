// This would be at: app/api/card-image/[...path]/route.ts
import { NextRequest, NextResponse } from 'next/server';

const GITHUB_BASE_URL = 'https://raw.githubusercontent.com/jalstad/RedemptionLackeyCCG/master/RedemptionQuick/sets/setimages/general/';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  try {
    const resolvedParams = await params;
    const imagePath = resolvedParams.path.join('/');
    const imageUrl = `${GITHUB_BASE_URL}${imagePath}`;
    
    console.log('Fetching image:', imageUrl); // Debug log
    
    // Fetch the image from GitHub
    const response = await fetch(imageUrl, {
      headers: {
        'User-Agent': 'RedemptionTournamentTracker/1.0'
      }
    });
    
    if (!response.ok) {
      console.error(`Image not found: ${imageUrl} (${response.status})`);
      return new NextResponse('Image not found', { status: 404 });
    }
    
    const imageBuffer = await response.arrayBuffer();
    
    // Return the image with caching headers
    return new NextResponse(imageBuffer, {
      headers: {
        'Content-Type': response.headers.get('content-type') || 'image/jpeg',
        'Cache-Control': 'public, max-age=31536000, immutable', // Cache for 1 year
        'X-Source': 'proxy-cache'
      },
    });
  } catch (error) {
    console.error('Error fetching image:', error);
    return new NextResponse('Internal Server Error', { status: 500 });
  }
}
