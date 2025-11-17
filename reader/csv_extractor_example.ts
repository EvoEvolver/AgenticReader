import { extractToCSV, batchExtractToCSV } from './csv_extractor';
import * as path from 'path';
import dotenv from 'dotenv';
// Load environment variables from .env file
dotenv.config();

/**
 * Example: Extract single file to CSV
 */
async function exampleSingleFile() {
  const jsonFilePath = path.join(__dirname, '../dataset/10.1039:c1pp05123g.html_answer.json');

  const headers = [
    'label',
    'absorption_max_nm',
    'emission_max_nm',
    'lifetime_ns',
    'quantum_yield',
  ];

  console.log('Extracting data from JSON to CSV...');

  const result = await extractToCSV(jsonFilePath, headers, {
    model: 'gpt-5',
    outputPath: jsonFilePath.replace('_answer.json', '_extracted.csv'),
  });

  console.log('\n=== Extraction Result ===');
  console.log(`Rows extracted: ${result.rowCount}`);
  console.log(`Headers: ${result.headers.join(', ')}`);
  console.log('\n=== CSV Output ===');
  console.log(result.csv);
}

// Run examples
async function main() {
  try {
    // Uncomment the example you want to run:

    await exampleSingleFile();

  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}
