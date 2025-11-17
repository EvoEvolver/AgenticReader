
import { readdirSync, existsSync } from 'fs';
import path, { join, parse } from 'path';
import {pdfToJSON} from "./pdfToJson";

const DATASET_DIR = path.resolve( __dirname, '..', 'dataset' );

/**
 * Convert all PDFs in the dataset directory to JSON
 * Skips PDFs that already have a corresponding .html.json file
 */
async function convertDataset() {
  console.log(`Scanning dataset directory: ${DATASET_DIR}\n`);

  // Read all files in the dataset directory
  const files = readdirSync(DATASET_DIR);

  // Filter for PDF files
  const pdfFiles = files.filter(file => file.toLowerCase().endsWith('.pdf'));

  console.log(`Found ${pdfFiles.length} PDF file(s)\n`);

  let converted = 0;
  let skipped = 0;
  let failed = 0;

  for (const pdfFile of pdfFiles) {
    const pdfPath = join(DATASET_DIR, pdfFile);
    const { dir, name } = parse(pdfPath);
    const expectedJsonPath = join(dir, `${name}.html.json`);

    console.log(`\n--- Processing: ${pdfFile} ---`);

    // Check if JSON already exists
    if (existsSync(expectedJsonPath)) {
      console.log(`✓ Skipping (JSON already exists): ${pdfFile}`);
      skipped++;
      continue;
    }

    try {
      console.log(`Converting: ${pdfFile}...`);
      await pdfToJSON(pdfPath);
      console.log(`✓ Successfully converted: ${pdfFile}`);
      converted++;
    } catch (error) {
      console.error(`✗ Failed to convert ${pdfFile}:`, error.message);
      failed++;
    }
  }

  console.log('\n=== Conversion Summary ===');
  console.log(`Total PDFs found: ${pdfFiles.length}`);
  console.log(`Successfully converted: ${converted}`);
  console.log(`Skipped (already exists): ${skipped}`);
  console.log(`Failed: ${failed}`);
}

// Run the conversion
convertDataset()
  .then(() => {
    console.log('\nDataset conversion complete!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\nFatal error during conversion:', error);
    process.exit(1);
  });
