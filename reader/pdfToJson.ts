import { convertPdfToHtml } from './mineru';
import { readFileSync } from 'fs';
import dotenv from 'dotenv';
import {htmlToMarkdownChunksWithSummaries} from "./htmlToMarkdownTree";

dotenv.config();

/**
 * Main function to convert PDF to structured JSON tree
 */
export async function pdfToJSON(pdfPath: string): Promise<string> {
  console.log('Step 1: Converting PDF to HTML...');
  const htmlPath = await convertPdfToHtml(pdfPath);

  console.log('Step 2: Reading HTML...');
  const htmlContent = readFileSync(htmlPath, 'utf-8');

  console.log('Step 3: Building tree structure...');
  const chunkWithSummaryJson = await htmlToMarkdownChunksWithSummaries(htmlContent);

  console.log('Step 4: Converting to JSON...');
  const jsonOutput = JSON.stringify(chunkWithSummaryJson, null, 2);
  const outputJsonPath = htmlPath + ".json";
  if (outputJsonPath) {
    const { writeFileSync } = await import('fs');
    writeFileSync(outputJsonPath, jsonOutput, 'utf-8');
    console.log(`JSON saved to: ${outputJsonPath}`);
  }
  return jsonOutput;
}