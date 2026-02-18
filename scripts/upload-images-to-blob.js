#!/usr/bin/env node

/**
 * Script to upload all card images from GitHub to Vercel Blob storage.
 * Run with: NODE_TLS_REJECT_UNAUTHORIZED=0 node scripts/upload-images-to-blob.js
 *
 * Requires BLOB_READ_WRITE_TOKEN in environment (from .env.local or env).
 * Re-runnable safely — skips images already uploaded to Blob.
 */

const fs = require('fs');
const https = require('https');
const { put, head } = require('@vercel/blob');

// Load .env.local manually (dotenv not required)
try {
  const envLocal = fs.readFileSync('.env.local', 'utf8');
  for (const line of envLocal.split('\n')) {
    const match = line.match(/^([^#=\s][^=]*)=(.*)$/);
    if (match) {
      const key = match[1].trim();
      const val = match[2].trim().replace(/^["']|["']$/g, '');
      if (!process.env[key]) process.env[key] = val;
    }
  }
} catch {
  // .env.local not found — rely on environment variables already set
}

const CARD_DATA_URL = "https://raw.githubusercontent.com/jalstad/RedemptionLackeyCCG/master/RedemptionQuick/sets/carddata.txt";
const CARD_IMAGE_BASE_URL = "https://raw.githubusercontent.com/jalstad/RedemptionLackeyCCG/master/RedemptionQuick/sets/setimages/general/";
const BLOB_PATH_PREFIX = 'card-images/';

const token = process.env.BLOB_READ_WRITE_TOKEN;
if (!token) {
  console.error('ERROR: BLOB_READ_WRITE_TOKEN is not set. Run `vercel env pull` first.');
  process.exit(1);
}

function sanitizeImgFile(f) {
  return f.replace(/\.jpe?g$/i, "");
}

function fetchBuffer(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (response) => {
      if (response.statusCode !== 200) {
        response.resume();
        return resolve(null); // Not found — skip
      }
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => resolve(Buffer.concat(chunks)));
      response.on('error', reject);
    }).on('error', reject);
  });
}

async function uploadImage(sanitizedImgFile) {
  const blobPathname = `${BLOB_PATH_PREFIX}${sanitizedImgFile}.jpg`;

  // Skip if already uploaded
  try {
    await head(blobPathname, { token });
    process.stdout.write('.');
    return 'skipped';
  } catch {
    // Not found in blob — proceed with upload
  }

  const imageUrl = `${CARD_IMAGE_BASE_URL}${sanitizedImgFile}.jpg`;
  const buffer = await fetchBuffer(imageUrl);

  if (!buffer) {
    process.stdout.write('x');
    return 'missing';
  }

  await put(blobPathname, buffer, {
    access: 'public',
    addRandomSuffix: false,
    token,
    contentType: 'image/jpeg',
  });

  process.stdout.write('+');
  return 'uploaded';
}

async function uploadAllImages() {
  console.log('Fetching card data...');

  const response = await fetch(CARD_DATA_URL);
  const text = await response.text();
  const lines = text.split('\n');
  const dataLines = lines.slice(1).filter(l => l.trim()); // Skip header

  console.log(`Found ${dataLines.length} cards`);

  // Deduplicate image filenames (multiple cards can share an image)
  const imageSet = new Set();
  for (const line of dataLines) {
    const cols = line.split('\t');
    const imgFile = cols[2]?.trim();
    if (imgFile) imageSet.add(sanitizeImgFile(imgFile));
  }

  const images = [...imageSet];
  console.log(`Unique images to process: ${images.length}`);
  console.log('Legend: + uploaded, . skipped (exists), x missing on GitHub\n');

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

    const batchNum = Math.floor(i / concurrencyLimit) + 1;
    const totalBatches = Math.ceil(images.length / concurrencyLimit);
    if (batchNum % 10 === 0 || batchNum === totalBatches) {
      console.log(`\nBatch ${batchNum}/${totalBatches} — uploaded: ${uploaded}, skipped: ${skipped}, missing: ${missing}`);
    }
  }

  console.log('\n\nDone!');
  console.log(`  Uploaded: ${uploaded}`);
  console.log(`  Skipped (already in blob): ${skipped}`);
  console.log(`  Missing on GitHub: ${missing}`);
}

uploadAllImages().catch((err) => {
  console.error('\nFatal error:', err);
  process.exit(1);
});