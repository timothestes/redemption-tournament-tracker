import { put, head } from '@vercel/blob';
import { NextRequest, NextResponse } from 'next/server';

const CARD_DATA_URL = "https://raw.githubusercontent.com/jalstad/RedemptionLackeyCCG/master/RedemptionQuick/sets/carddata.txt";
const CARD_IMAGE_BASE_URL = "https://raw.githubusercontent.com/jalstad/RedemptionLackeyCCG/master/RedemptionQuick/sets/setimages/general/";
const BLOB_PATH_PREFIX = 'card-images/';

function sanitizeImgFile(f: string): string {
  return f.replace(/\.jpe?g$/i, "");
}

async function fetchBuffer(url: string): Promise<Buffer | null> {
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  } catch {
    return null;
  }
}

async function uploadImage(sanitizedImgFile: string): Promise<'uploaded' | 'skipped' | 'missing'> {
  const blobPathname = `${BLOB_PATH_PREFIX}${sanitizedImgFile}.jpg`;
  const token = process.env.BLOB_READ_WRITE_TOKEN!;

  // Skip if already uploaded
  try {
    await head(blobPathname, { token });
    return 'skipped';
  } catch {
    // Not found in blob — proceed with upload
  }

  const imageUrl = `${CARD_IMAGE_BASE_URL}${sanitizedImgFile}.jpg`;
  const buffer = await fetchBuffer(imageUrl);

  if (!buffer) {
    return 'missing';
  }

  await put(blobPathname, buffer, {
    access: 'public',
    addRandomSuffix: false,
    token,
    contentType: 'image/jpeg',
  });

  return 'uploaded';
}

export async function GET(request: NextRequest) {
  // Verify cron secret to prevent unauthorized access
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    console.log('Starting card image sync...');

    const response = await fetch(CARD_DATA_URL);
    const text = await response.text();
    const lines = text.split('\n');
    const dataLines = lines.slice(1).filter(l => l.trim());

    // Deduplicate image filenames
    const imageSet = new Set<string>();
    for (const line of dataLines) {
      const cols = line.split('\t');
      const imgFile = cols[2]?.trim();
      if (imgFile) imageSet.add(sanitizeImgFile(imgFile));
    }

    const images = [...imageSet];
    console.log(`Found ${images.length} unique images to process`);

    const concurrencyLimit = 10;
    let uploaded = 0, skipped = 0, missing = 0;

    for (let i = 0; i < images.length; i += concurrencyLimit) {
      const batch = images.slice(i, i + concurrencyLimit);
      const results = await Promise.all(batch.map(uploadImage));

      for (const r of results) {
        if (r === 'uploaded') uploaded++;
        else if (r === 'skipped') skipped++;
        else if (r === 'missing') missing++;
      }
    }

    const result = {
      success: true,
      totalImages: images.length,
      uploaded,
      skipped,
      missing,
      timestamp: new Date().toISOString(),
    };

    console.log('Sync complete:', result);
    return NextResponse.json(result);
  } catch (error) {
    console.error('Sync failed:', error);
    return NextResponse.json(
      { error: 'Sync failed', message: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

// Vercel cron jobs have a 10-second timeout on hobby plan, 60s on pro
// This might need adjustment based on the number of images
export const maxDuration = 300; // 5 minutes (requires pro plan for >60s)
