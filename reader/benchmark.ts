import * as fs from 'fs';
import * as path from 'path';

interface GroundTruthEntry {
  Article: string;
  Tag: string;
  Chromophore: string;
  Solvent: string;
  'Absorption max (nm)': string;
  'Emission max (nm)': string;
  'Lifetime (ns)': string;
  'Quantum yield': string;
  'log(e/mol-1 dm3 cm-1)': string;
  'abs FWHM (cm-1)': string;
  'emi FWHM (cm-1)': string;
  'abs FWHM (nm)': string;
  'emi FWHM (nm)': string;
  'Molecular weight (g mol-1)': string;
  Reference: string;
  link: string;
}

interface ExtractedEntry {
  label: string;
  absorption_max_nm: string;
  emission_max_nm: string;
  lifetime_ns: string;
  quantum_yield: string;
}

interface MatchResult {
  label: string;
  absorption_match: boolean;
  emission_match: boolean;
  lifetime_match: boolean;
  quantum_yield_match: boolean;
  found_in_ground_truth: boolean;
}

interface BenchmarkResult {
  filename: string;
  doi: string;
  total_extracted: number;
  total_ground_truth: number;
  matched_entries: number;
  precision: number;
  recall: number;
  f1_score: number;
  matches: MatchResult[];
}

/**
 * Parse CSV file into array of objects
 */
function parseCSV<T>(content: string): T[] {
  const lines = content.trim().split('\n');
  if (lines.length === 0) return [];

  const headers = lines[0].split(',').map(h => h.trim());
  const results: T[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;

    const values = parseCSVLine(line);
    const obj: any = {};

    headers.forEach((header, index) => {
      obj[header] = values[index] || '';
    });

    results.push(obj as T);
  }

  return results;
}

/**
 * Parse a single CSV line, handling quoted values
 */
function parseCSVLine(line: string): string[] {
  const values: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      values.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }

  values.push(current.trim());
  return values;
}

/**
 * Extract DOI from filename
 * e.g., "10.1021:cm400945h.html_extracted.csv" -> "10.1021/cm400945h"
 */
function extractDOI(filename: string): string {
  const match = filename.match(/^(.+)\.html_extracted\.csv$/);
  if (!match) return '';

  // Replace : with /
  return match[1].replace('-', '/');
}

/**
 * Compare numerical values with tolerance
 */
function compareNumerical(extracted: string, groundTruth: string, tolerance: number = 0.1): {
  match: boolean;
  error: number | null;
} {
  if (!groundTruth)
  {
    return { match: true, error: null };
  }
  const extractedNum = parseFloat(extracted);
  const groundTruthNum = parseFloat(groundTruth);

  if (isNaN(extractedNum) && (!isNaN(groundTruthNum))) {
    return { match: false, error: null };
  }

  const error = extractedNum - groundTruthNum;
  const match = Math.abs(error) <= tolerance || Math.abs(error / groundTruthNum) <= 0.01;

  return { match, error };
}

/**
 * Benchmark a single extracted CSV file against ground truth
 */
function benchmarkFile(
  extractedFilePath: string,
  groundTruth: GroundTruthEntry[]
): BenchmarkResult {
  const filename = path.basename(extractedFilePath);
  const doi = extractDOI(filename);

  console.log(`\n= Benchmarking: ${filename}`);
  console.log(`   DOI: ${doi}`);

  // Load extracted data
  const extractedContent = fs.readFileSync(extractedFilePath, 'utf-8');
  const extractedData = parseCSV<ExtractedEntry>(extractedContent);

  // Filter ground truth for this DOI
  const relevantGroundTruth = groundTruth.filter(entry =>
    entry.link && entry.link.includes(doi) && entry['Absorption max (nm)'] !== ''
  );

  console.log(`   Extracted entries: ${extractedData.length}`);
  console.log(`   Ground truth entries: ${relevantGroundTruth.length}`);

  // Match entries
  const matches: MatchResult[] = [];

  let matchedCount = 0;

  for (const extracted of extractedData) {
    // Find matching entry in ground truth by absorption max value
    // Allow for small numerical differences (tolerance of 1 nm or 1% relative error)
    const extractedAbsorption = parseFloat(extracted.absorption_max_nm);
    const groundTruthEntry = relevantGroundTruth.find(gt => {
      const gtAbsorption = parseFloat(gt['Absorption max (nm)']);
      if (isNaN(extractedAbsorption) || isNaN(gtAbsorption)) return false;

      const diff = Math.abs(extractedAbsorption - gtAbsorption);
      const relativeDiff = Math.abs(diff / gtAbsorption);

      return diff <= 0.1 || relativeDiff <= 0.01;
    });

    if (!groundTruthEntry) {
      matches.push({
        label: extracted.label,
        absorption_match: false,
        emission_match: false,
        lifetime_match: false,
        quantum_yield_match: false,
        found_in_ground_truth: false,
      });
      continue;
    }

    // Compare each field
    const absComparison = compareNumerical(
      extracted.absorption_max_nm,
      groundTruthEntry['Absorption max (nm)']
    );
    const emiComparison = compareNumerical(
      extracted.emission_max_nm,
      groundTruthEntry['Emission max (nm)']
    );
    const lifetimeComparison = compareNumerical(
      extracted.lifetime_ns,
      groundTruthEntry['Lifetime (ns)']
    );
    const quantumYieldComparison = compareNumerical(
      extracted.quantum_yield,
      groundTruthEntry['Quantum yield']
    );

    const allMatch = absComparison.match && emiComparison.match &&
                     lifetimeComparison.match && quantumYieldComparison.match;

    if (allMatch) matchedCount++;

    matches.push({
      label: extracted.label,
      absorption_match: absComparison.match,
      emission_match: emiComparison.match,
      lifetime_match: lifetimeComparison.match,
      quantum_yield_match: quantumYieldComparison.match,
      found_in_ground_truth: true,
    });
  }

  // Calculate metrics
  const precision = extractedData.length > 0 ? matchedCount / extractedData.length : 0;
  const recall = relevantGroundTruth.length > 0 ? matchedCount / relevantGroundTruth.length : 0;
  const f1Score = (precision + recall) > 0 ? (2 * precision * recall) / (precision + recall) : 0;

  return {
    filename,
    doi,
    total_extracted: extractedData.length,
    total_ground_truth: relevantGroundTruth.length,
    matched_entries: matchedCount,
    precision,
    recall,
    f1_score: f1Score,
    matches,
  };
}

/**
 * Print benchmark results
 */
function printResults(result: BenchmarkResult): void {
  console.log('\n' + '='.repeat(80));
  console.log(`= ${result.filename}`);
  console.log('='.repeat(80));
  console.log(`DOI: ${result.doi}`);
  console.log(`\n= Coverage Metrics:`);
  console.log(`   Total Extracted: ${result.total_extracted}`);
  console.log(`   Total Ground Truth: ${result.total_ground_truth}`);
  console.log(`   Matched Entries: ${result.matched_entries}`);
  console.log(`   Precision: ${(result.precision * 100).toFixed(2)}%`);
  console.log(`   Recall: ${(result.recall * 100).toFixed(2)}%`);
  console.log(`   F1 Score: ${(result.f1_score * 100).toFixed(2)}%`);
}

/**
 * Main benchmark pipeline
 */
async function main() {
  console.log('= Starting Benchmark Pipeline\n');

  const datasetDir = path.join(__dirname, '..', 'dataset');
  const groundTruthPath = path.join(datasetDir, 'ground.csv');

  // Load ground truth
  console.log('= Loading ground truth data...');
  const groundTruthContent = fs.readFileSync(groundTruthPath, 'utf-8');
  const groundTruth = parseCSV<GroundTruthEntry>(groundTruthContent);
  console.log(`   Loaded ${groundTruth.length} ground truth entries`);

  // Find all extracted CSV files
  const files = fs.readdirSync(datasetDir);
  const extractedFiles = files
    .filter(f => f.endsWith('_extracted.csv'))
    .map(f => path.join(datasetDir, f));

  console.log(`\n= Found ${extractedFiles.length} extracted files to benchmark`);

  // Benchmark each file
  const results: BenchmarkResult[] = [];

  for (const file of extractedFiles) {
    const result = benchmarkFile(file, groundTruth);
    results.push(result);
    printResults(result);
  }

  // Print summary
  console.log('\n' + '='.repeat(80));
  console.log('= OVERALL SUMMARY');
  console.log('='.repeat(80));

  const totalExtracted = results.reduce((sum, r) => sum + r.total_extracted, 0);
  const totalGroundTruth = results.reduce((sum, r) => sum + r.total_ground_truth, 0);
  const totalMatched = results.reduce((sum, r) => sum + r.matched_entries, 0);

  // Calculate overall metrics from totals
  const overallPrecision = totalExtracted > 0 ? totalMatched / totalExtracted : 0;
  const overallRecall = totalGroundTruth > 0 ? totalMatched / totalGroundTruth : 0;
  const overallF1 = (overallPrecision + overallRecall) > 0
    ? (2 * overallPrecision * overallRecall) / (overallPrecision + overallRecall)
    : 0;

  console.log(`\nFiles Processed: ${results.length}`);
  console.log(`Total Extracted: ${totalExtracted}`);
  console.log(`Total Ground Truth: ${totalGroundTruth}`);
  console.log(`Total Matched: ${totalMatched}`);
  console.log(`\nOverall Precision: ${(overallPrecision * 100).toFixed(2)}%`);
  console.log(`Overall Recall: ${(overallRecall * 100).toFixed(2)}%`);
  console.log(`Overall F1 Score: ${(overallF1 * 100).toFixed(2)}%`);

  console.log('\n Benchmark complete!\n');

  // Save results to JSON
  const resultsPath = path.join(datasetDir, 'benchmark_results.json');
  fs.writeFileSync(resultsPath, JSON.stringify(results, null, 2));
  console.log(`= Results saved to: ${resultsPath}`);
}

// Run the benchmark
main().catch(console.error);
