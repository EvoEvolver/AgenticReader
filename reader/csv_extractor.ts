import { generateObject } from 'ai';
import { openai } from '@ai-sdk/openai';
import { z } from 'zod';
import * as fs from 'fs/promises';
import * as path from 'path';

export interface CsvExtractorOptions {
  model?: string;
  outputPath?: string;
}

export interface ExtractionResult {
  csv: string;
  rowCount: number;
  headers: string[];
}

/**
 * Extracts structured data from answer JSON files and converts to CSV format
 * @param jsonFilePath - Path to the JSON file containing question and answer
 * @param headers - Array of column headers to extract (e.g., ['label', 'absorption_max_nm', 'emission_max_nm', 'lifetime_ns', 'quantum_yield', 'chromophore'])
 * @param options - Configuration options including model and output path
 * @returns CSV string and metadata
 */
export async function extractToCSV(
  jsonFilePath: string,
  headers: string[],
  options: CsvExtractorOptions = {}
): Promise<ExtractionResult> {
  const { model = 'gpt-5', outputPath } = options;

  // Read the JSON file
  const fileContent = await fs.readFile(jsonFilePath, 'utf-8');
  const data = JSON.parse(fileContent);

  if (!data.question || !data.answer) {
    throw new Error('Invalid JSON format: missing "question" or "answer" fields');
  }

  // Create a dynamic Zod schema based on headers
  // Each row is an object with keys matching the headers
  const rowSchema = z.record(z.string(), z.any());
  const extractionSchema = z.object({
    rows: z.array(rowSchema).describe('Array of data rows, each row is an object with keys matching the requested headers'),
  });

  // Use AI SDK to extract structured data
  const result = await generateObject({
    model: openai(model),
    schema: extractionSchema,
    prompt: `You are a data extraction assistant. Extract structured data from the following answer text and format it according to the specified column headers.

Question: ${data.question}

Answer: ${data.answer}

Column Headers: ${headers.join(', ')}

Instructions:
- Extract all relevant data points from the answer text
- Create one row for each distinct entity/compound mentioned. You can modify the label and conditions to it for uniqueness.
- Ensure each cell contains only one number
- If a value is not found for a header, use an empty string

Return the data as an array of row objects, where each object has keys matching the headers.`,
  });

  // Convert to CSV format
  const csv = convertToCSV(result.object.rows, headers);

  // Optionally write to file
  if (outputPath) {
    await fs.writeFile(outputPath, csv, 'utf-8');
  }

  return {
    csv,
    rowCount: result.object.rows.length,
    headers,
  };
}

/**
 * Converts array of objects to CSV string
 */
function convertToCSV(rows: Record<string, any>[], headers: string[]): string {
  // Escape CSV values
  const escapeCsvValue = (value: string | number | any): string => {
    // Convert to string first
    const stringValue = value != null ? String(value) : '';

    if (stringValue.includes(',') || stringValue.includes('"') || stringValue.includes('\n')) {
      return `"${stringValue.replace(/"/g, '""')}"`;
    }
    return stringValue;
  };

  // Create header row
  const headerRow = headers.map(escapeCsvValue).join(',');

  // Create data rows
  const dataRows = rows.map(row => {
    return headers.map(header => {
      const value = row[header] || '';
      return escapeCsvValue(value);
    }).join(',');
  });

  return [headerRow, ...dataRows].join('\n');
}

/**
 * Batch process multiple JSON files to CSV
 * @param inputDir - Directory containing JSON files
 * @param outputDir - Directory to write CSV files
 * @param headers - Array of column headers
 * @param options - Configuration options
 */
export async function batchExtractToCSV(
  inputDir: string,
  outputDir: string,
  headers: string[],
  options: CsvExtractorOptions = {}
): Promise<void> {
  // Ensure output directory exists
  await fs.mkdir(outputDir, { recursive: true });

  // Read all JSON files
  const files = await fs.readdir(inputDir);
  const jsonFiles = files.filter(f => f.endsWith('.json') || f.endsWith('_answer.json'));

  console.log(`Found ${jsonFiles.length} JSON files to process`);

  for (const file of jsonFiles) {
    console.log(`Processing ${file}...`);
    const inputPath = path.join(inputDir, file);
    const outputFileName = file.replace(/\.json$/, '.csv');
    const outputPath = path.join(outputDir, outputFileName);

    try {
      const result = await extractToCSV(inputPath, headers, {
        ...options,
        outputPath,
      });
      console.log(`✓ ${file} -> ${outputFileName} (${result.rowCount} rows)`);
    } catch (error) {
      console.error(`✗ Error processing ${file}:`, error);
    }
  }
}
