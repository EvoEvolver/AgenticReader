import * as fs from 'fs';
import * as path from 'path';
import { agenticReaderWithEvents } from './agenticReader';
import { extractToCSV } from './csv_extractor';
import dotenv from 'dotenv';

dotenv.config();

/**
 * Process a single .html.json file:
 * 1. Run agentic reader to generate answer
 * 2. Convert answer to CSV
 */
async function processHtmlJsonFile(jsonPath: string) {
  console.log('\n' + '='.repeat(80));
  console.log(`Processing: ${path.basename(jsonPath)}`);
  console.log('='.repeat(80));

  // Check if CSV already exists
  const csvPath = jsonPath.replace('.html.json', '.html_extracted.csv');
  if (fs.existsSync(csvPath)) {
    console.log(`  ⊘ Skipped: CSV already exists (${path.basename(csvPath)})`);
    return {
      success: true,
      skipped: true,
      csvPath,
    };
  }

  // Step 1: Run agentic reader
  console.log('\n[Step 1/2] Running Agentic Reader...');

  const data = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
  const { fullContent, chunks } = data;

  console.log(`  - Full content length: ${fullContent.length} characters`);
  console.log(`  - Number of chunks: ${chunks.length}`);

  // Define the question to ask
  const question = "Give a list of label\tAbsorption max (nm)\tEmission max (nm)\tLifetime (ns)\tQuantum yield for the compounds mentioned in the document.";

  let answer = '';

  // Event handler to capture the answer
  const emitEvent = (event: string, data: any) => {
    if (event === 'answer') {
      answer = data.answer;
      console.log(`  Answer generated (${answer.length} characters)`);
    }
  };

  // Run the agentic reader with events
  try {
    await agenticReaderWithEvents(
      question,
      fullContent,
      chunks,
      emitEvent,
      {
        max_iterations: 30,
        model: 'gpt-5',
        include_metadata: true,
      }
    );

    if (answer) {
      // Save answer to JSON file
      const answerPath = jsonPath.replace('.html.json', '.html_answer.json');
      fs.writeFileSync(answerPath, JSON.stringify({ question, answer }, null, 2), 'utf-8');
      console.log(`  Answer saved to: ${path.basename(answerPath)}`);

      // Step 2: Convert to CSV
      console.log('\n[Step 2/2] Converting to CSV...');

      const headers = [
        'label',
        'absorption_max_nm',
        'emission_max_nm',
        'lifetime_ns',
        'quantum_yield'
      ];

      const result = await extractToCSV(answerPath, headers, {
        model: 'gpt-5',
        outputPath: answerPath.replace('_answer.json', '_extracted.csv'),
      });

      console.log(`  CSV extracted with ${result.rowCount} rows`);
      console.log(`  CSV saved to: ${path.basename(answerPath.replace('_answer.json', '_extracted.csv'))}`);

      return {
        success: true,
        answerPath,
        csvPath: answerPath.replace('_answer.json', '_extracted.csv'),
        rowCount: result.rowCount,
      };
    } else {
      throw new Error('No answer was generated');
    }
  } catch (error) {
    console.error(`  Error processing ${path.basename(jsonPath)}:`, error);
    return {
      success: false,
      error: error.message,
    };
  }
}

/**
 * Process all .html.json files in the dataset directory
 */
async function processAllHtmlJsonFiles(datasetDir: string) {
  console.log('='.repeat(80));
  console.log('BATCH PROCESSING: HTML.JSON   ANSWER.JSON CSV');
  console.log('='.repeat(80));

  // Find all .html.json files
  const files = fs.readdirSync(datasetDir);
  const htmlJsonFiles = files
    .filter(f => f.endsWith('.html.json'))
    .map(f => path.join(datasetDir, f));

  console.log(`\nFound ${htmlJsonFiles.length} .html.json files to process:\n`);
  htmlJsonFiles.forEach((f, i) => {
    console.log(`  ${i + 1}. ${path.basename(f)}`);
  });

  const results = [];

  for (const filePath of htmlJsonFiles) {
    const result = await processHtmlJsonFile(filePath);
    results.push({
      file: path.basename(filePath),
      ...result,
    });
  }

  // Summary
  console.log('\n' + '='.repeat(80));
  console.log('PROCESSING SUMMARY');
  console.log('='.repeat(80));

  const successful = results.filter(r => r.success && !r.skipped);
  const skipped = results.filter(r => r.skipped);
  const failed = results.filter(r => !r.success);

  console.log(`\nSuccessful: ${successful.length}/${results.length}`);
  if (skipped.length > 0) {
    console.log(`Skipped: ${skipped.length}/${results.length} (CSV already exists)`);
  }
  if (failed.length > 0) {
    console.log(`Failed: ${failed.length}/${results.length}`);
    console.log('\nFailed files:');
    failed.forEach(f => {
      console.log(`  - ${f.file}: ${f.error}`);
    });
  }

  console.log('\n' + '='.repeat(80));
}

/**
 * Main entry point
 */
async function main() {
  const datasetDir = path.join(__dirname, '../dataset');

  try {
    await processAllHtmlJsonFiles(datasetDir);
  } catch (error) {
    console.error('Fatal error:', error);
    process.exit(1);
  }
}

// Run if executed directly
if (require.main === module) {
  main();
}

export { processHtmlJsonFile, processAllHtmlJsonFiles };
