import fs from 'fs';
import path from 'path';
import axios from 'axios';
import dotenv from 'dotenv';
import AdmZip from 'adm-zip';
import MarkdownIt from 'markdown-it';
import texmath from 'markdown-it-texmath';
import { URL } from 'url';
import { uploadImageToMinio } from './minioClient';
import katex from 'katex';

dotenv.config();

const API_BASE_URL = process.env.MINERU_API_URL || 'https://minerudeployment-production.up.railway.app';

interface ParseOptions {
  parseFormula?: boolean;
  parseTable?: boolean;
  parseOcr?: boolean;
  dpi?: number;
  timeout?: number;
}

/**
 * Call the /parse/sync/zip API endpoint to get ZIP file
 * @param pdfPath - Path to the PDF file
 * @param options - Parsing options
 * @returns Buffer containing the ZIP file
 */
async function callParseApi(
  pdfPath: string,
  options: ParseOptions = {}
): Promise<Buffer> {
  const {
    parseFormula = true,
    parseTable = true,
    parseOcr = true,
    dpi = 200,
    timeout = 600
  } = options;

  console.log(`Parsing PDF: ${pdfPath}`);
  console.log(`Options: formula=${parseFormula}, table=${parseTable}, ocr=${parseOcr}, dpi=${dpi}`);

  // Read the PDF file
  const fileBuffer = fs.readFileSync(pdfPath);
  const filename = path.basename(pdfPath);

  // Create form data using FormData from form-data package
  const FormData = require('form-data');
  const formData = new FormData();

  formData.append('file', fileBuffer, {
    filename: filename,
    contentType: 'application/pdf'
  });
  formData.append('parse_formula', String(parseFormula));
  formData.append('parse_table', String(parseTable));
  formData.append('parse_ocr', String(parseOcr));
  formData.append('dpi', String(dpi));

  // Send request to the API
  console.log(`Sending request to ${API_BASE_URL}/parse/sync/zip`);

  const response = await axios.post(
    `${API_BASE_URL}/parse/sync/zip`,
    formData,
    {
      headers: {
        ...formData.getHeaders()
      },
      responseType: 'arraybuffer',
      timeout: timeout * 1000,
      maxContentLength: Infinity,
      maxBodyLength: Infinity
    }
  );

  console.log('✅ PDF parsed successfully');
  console.log(`Processing time: ${response.headers['x-processing-time']}s`);

  return Buffer.from(response.data);
}

/**
 * Download and unzip the parsing result
 * @param zipBuffer - ZIP file buffer
 * @param pdfPath - Original PDF path (for naming)
 * @returns Path to the extracted directory
 */
function unzipResult(zipBuffer: Buffer, pdfPath: string): string {
  console.log('Extracting parsing results...');

  const zipFilename = path.basename(pdfPath, '.pdf');
  const outputDir = path.join(process.cwd(), 'pdf_result', zipFilename);

  fs.mkdirSync(outputDir, { recursive: true });

  const zip = new AdmZip(zipBuffer);
  zip.extractAllTo(outputDir, true);

  console.log(`Results extracted to: ${outputDir}`);
  return outputDir;
}

/**
 * Process markdown images and upload them to MinIO
 * @param mdPath - Path to the markdown file
 * @param urlPrefix - URL prefix for image references
 * @returns Array of original image paths
 */
function processMarkdownImages(mdPath: string, urlPrefix: string): string[] {
  const content = fs.readFileSync(mdPath, 'utf-8');
  const imageRegex = /!\[.*?\]\((.*?)\)/g;
  const originalPaths: string[] = [];

  const newContent = content.replace(imageRegex, (match, src) => {
    originalPaths.push(src);
    const filename = 'images/' + path.basename(src);
    const fullUrl = new URL(filename, urlPrefix).toString();
    return match.replace(src, fullUrl);
  });

  const processedPath = path.join(path.dirname(mdPath), 'processed.md');
  fs.writeFileSync(processedPath, newContent, 'utf-8');

  console.log(`Found ${originalPaths.length} images to process`);
  return originalPaths;
}

/**
 * Main pipeline to convert PDF to HTML using self-hosted MinerU API
 * @param pdfPath - Path to the PDF file
 * @param outputPath - Optional path to save the HTML output
 * @param options - Parsing options
 * @returns HTML content
 */
export async function myPdfPipeline(
  pdfPath: string,
  outputPath?: string,
  options: ParseOptions = {}
): Promise<string> {
  console.log('\n=== Starting Self-Hosted MinerU PDF to HTML Pipeline ===\n');
  console.log(`Input file: ${pdfPath}`);

  // Step 1: Call API to get ZIP
  const zipBuffer = await callParseApi(pdfPath, options);

  // Step 2: Unzip results
  const outputDir = unzipResult(zipBuffer, pdfPath);

  // Step 3: Find the markdown file
  // The ZIP from MinerU typically contains: auto/[filename]_layout.md or similar
  let fullMdPath: string | null = null;

  // Search for markdown files recursively
  function findMarkdownFiles(dir: string): string[] {
    const results: string[] = [];
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        results.push(...findMarkdownFiles(fullPath));
      } else if (entry.name.endsWith('.md')) {
        results.push(fullPath);
      }
    }
    return results;
  }

  const mdFiles = findMarkdownFiles(outputDir);

  // Prefer files named 'full.md' or containing 'layout' in the name
  fullMdPath = mdFiles.find(f => path.basename(f) === 'full.md') ||
               mdFiles.find(f => f.includes('_layout.md')) ||
               mdFiles[0];

  if (!fullMdPath || !fs.existsSync(fullMdPath)) {
    console.log('Available files in output:', mdFiles);
    throw new Error(`Markdown file not found in: ${outputDir}`);
  }

  console.log(`Found markdown file: ${fullMdPath}`);

  // Step 4: Process images and upload to MinIO
  console.log('Processing images...');
  const storageUrl = process.env.MINIO_PUBLIC_HOST || 'https://storage.treer.ai/';
  const assetPaths = processMarkdownImages(fullMdPath, storageUrl);
  const processedMdPath = path.join(path.dirname(fullMdPath), 'processed.md');

  if (assetPaths.length > 0) {
    console.log('Uploading images to MinIO...');
    await Promise.all(
      assetPaths.map(asset =>
        uploadImageToMinio(path.join(outputDir, asset))
      )
    );
    console.log('All images uploaded successfully');
  }

  // Step 5: Convert markdown to HTML
  console.log('Converting markdown to HTML...');
  const md = new MarkdownIt({ html: true }).use(texmath, {
    engine: katex,
    delimiters: 'dollars',
  });

  const markdownContent = fs.readFileSync(processedMdPath, 'utf-8');
  const htmlContent = `<html>
<head>
  <meta charset="UTF-8">
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.8/dist/katex.min.css">
  <style>
    body {
      max-width: 900px;
      margin: 40px auto;
      padding: 0 20px;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
      line-height: 1.6;
      color: #333;
    }
    article {
      font-size: 16px;
    }
    img {
      max-width: 100%;
      height: auto;
    }
    table {
      border-collapse: collapse;
      width: 100%;
      margin: 20px 0;
    }
    th, td {
      border: 1px solid #ddd;
      padding: 8px;
      text-align: left;
    }
    th {
      background-color: #f5f5f5;
    }
  </style>
</head>
<body>
  <article>${md.render(markdownContent)}</article>
</body>
</html>`;

  // Step 6: Save output if path specified
  if (outputPath) {
    fs.writeFileSync(outputPath, htmlContent, 'utf-8');
    console.log(`\nHTML saved to: ${outputPath}`);
  }

  // Step 7: Clean up temporary directory
  console.log('Cleaning up temporary files...');
  await fs.promises.rm(outputDir, { recursive: true, force: true });

  console.log('\n=== Pipeline completed successfully! ===\n');
  return htmlContent;
}

/**
 * Simple function to just get the ZIP file
 * @param pdfPath - Path to the PDF file
 * @param options - Parsing options
 * @returns Buffer containing the ZIP file
 */
export async function parsePdfToZip(
  pdfPath: string,
  options: ParseOptions = {}
): Promise<Buffer> {
  return await callParseApi(pdfPath, options);
}

/**
 * Parse PDF and save ZIP to file
 * @param pdfPath - Path to the PDF file
 * @param outputPath - Path where to save the ZIP file
 * @param options - Parsing options
 */
export async function parsePdfAndSaveZip(
  pdfPath: string,
  outputPath: string,
  options: ParseOptions = {}
): Promise<void> {
  const zipBuffer = await callParseApi(pdfPath, options);
  fs.writeFileSync(outputPath, zipBuffer);
  console.log(`ZIP file saved to: ${outputPath}`);
}
