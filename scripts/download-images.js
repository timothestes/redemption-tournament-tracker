#!/usr/bin/env node

/**
 * Script to download all card images from GitHub and store them locally
 * Run with: node scripts/download-images.js
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

const CARD_DATA_URL = "https://raw.githubusercontent.com/jalstad/RedemptionLackeyCCG/master/RedemptionQuick/sets/carddata.txt";
const CARD_IMAGE_BASE_URL = "https://raw.githubusercontent.com/jalstad/RedemptionLackeyCCG/master/RedemptionQuick/sets/setimages/general/";
const LOCAL_IMAGES_DIR = path.join(__dirname, '../public/card-images');

// Create directory if it doesn't exist
if (!fs.existsSync(LOCAL_IMAGES_DIR)) {
  fs.mkdirSync(LOCAL_IMAGES_DIR, { recursive: true });
}

function sanitizeImgFile(f) {
  return f.replace(/\.jpe?g$/i, "");
}

function downloadImage(url, filepath) {
  return new Promise((resolve, reject) => {
    // Check if file already exists
    if (fs.existsSync(filepath)) {
      console.log(`Skipping ${filepath} (already exists)`);
      resolve();
      return;
    }

    const file = fs.createWriteStream(filepath);
    https.get(url, (response) => {
      if (response.statusCode === 200) {
        response.pipe(file);
        file.on('finish', () => {
          file.close();
          console.log(`Downloaded: ${filepath}`);
          resolve();
        });
      } else {
        console.error(`Failed to download ${url}: ${response.statusCode}`);
        fs.unlink(filepath, () => {}); // Delete partial file
        resolve(); // Don't reject, just skip this image
      }
    }).on('error', (err) => {
      console.error(`Error downloading ${url}:`, err.message);
      fs.unlink(filepath, () => {}); // Delete partial file
      resolve(); // Don't reject, just skip this image
    });
  });
}

async function downloadAllImages() {
  try {
    console.log('Fetching card data...');
    
    // Fetch card data
    const response = await fetch(CARD_DATA_URL);
    const text = await response.text();
    const lines = text.split('\n');
    const dataLines = lines.slice(1).filter(l => l.trim()); // Skip header
    
    console.log(`Found ${dataLines.length} cards`);
    
    const downloadPromises = [];
    const concurrencyLimit = 10; // Download 10 images at a time
    
    for (let i = 0; i < dataLines.length; i += concurrencyLimit) {
      const batch = dataLines.slice(i, i + concurrencyLimit);
      
      const batchPromises = batch.map((line) => {
        const cols = line.split('\t');
        const imgFile = cols[2] || '';
        
        if (!imgFile) return Promise.resolve();
        
        const sanitizedImgFile = sanitizeImgFile(imgFile);
        const imageUrl = `${CARD_IMAGE_BASE_URL}${sanitizedImgFile}.jpg`;
        const localPath = path.join(LOCAL_IMAGES_DIR, `${sanitizedImgFile}.jpg`);
        
        return downloadImage(imageUrl, localPath);
      });
      
      await Promise.all(batchPromises);
      console.log(`Completed batch ${Math.floor(i / concurrencyLimit) + 1}/${Math.ceil(dataLines.length / concurrencyLimit)}`);
    }
    
    console.log('All images downloaded!');
  } catch (error) {
    console.error('Error:', error);
  }
}

downloadAllImages();
