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

interface MinerUSubmitResponse {
  code: number;
  data: {
    task_id: string;
  };
  msg: string;
  trace_id: string;
}

interface MinerUTaskResponse {
  code: number;
  data: {
    task_id: string;
    state: 'done' | 'pending' | 'running' | 'failed' | 'converting';
    full_zip_url?: string;
    err_msg?: string;
    extract_progress?: {
      extracted_pages: number;
      total_pages: number;
      start_time: string;
    };
  };
  msg: string;
  trace_id: string;
}

/**
 * Submit a PDF file URL to MinerU API for parsing
 * @param fileUrl - URL of the PDF file
 * @returns Task ID for tracking the parsing job
 */
async function submitParsingJob(fileUrl: string): Promise<string> {
  const url = 'https://mineru.net/api/v4/extract/task';
  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${process.env.MINERU_TOKEN}`,
  };
  const data = {
    url: fileUrl,
    is_ocr: true,
    enable_formula: true,
    enable_table: false,
    language: 'en',
    page_range: '1-50',
    extra_formats: ['html']
  };

  console.log('Submitting parsing job to MinerU API...');
  const res = await axios.post<MinerUSubmitResponse>(url, data, { headers });

  if (res.data?.data?.task_id) {
    console.log(`Task submitted successfully. Task ID: ${res.data.data.task_id}`);
    return res.data.data.task_id;
  }
  throw new Error(`Invalid response: task_id not found. Response data: ${JSON.stringify(res.data)}`);
}

/**
 * Wait for MinerU parsing task to complete
 * @param taskId - Task ID from submitParsingJob
 * @returns URL of the result ZIP file
 */
async function waitForParsingResult(taskId: string): Promise<string> {
  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${process.env.MINERU_TOKEN}`,
  };

  const requestPeriod = 2000; // 2 seconds
  const maxTimeToWait = 10 * 60 * 1000; // 10 minutes
  let timeWaited = 0;

  console.log('Waiting for parsing to start...');

  while (true) {
    const res = await axios.get<MinerUTaskResponse>(
      `https://mineru.net/api/v4/extract/task/${taskId}`,
      { headers }
    );
    const state = res.data.data.state;

    if (state === 'running' && res.data.data.extract_progress) {
      const progress = res.data.data.extract_progress;
      console.log(`Progress: ${progress.extracted_pages}/${progress.total_pages} pages`);
    }

    if (state === 'done') {
      console.log('Parsing completed successfully!');
      if (!res.data.data.full_zip_url) {
        throw new Error('Parsing completed but no result URL provided');
      }
      return res.data.data.full_zip_url;
    }

    if (state === 'failed') {
      throw new Error(`Parsing failed: ${res.data.data.err_msg || 'Unknown error'}`);
    }

    await new Promise(resolve => setTimeout(resolve, requestPeriod));
    timeWaited += requestPeriod;

    if (timeWaited > maxTimeToWait) {
      throw new Error('Parsing timeout: exceeded maximum wait time of 10 minutes');
    }
  }
}

/**
 * Download and unzip the MinerU result
 * @param zipUrl - URL of the result ZIP file
 * @returns Path to the extracted directory
 */
async function downloadAndUnzipResult(zipUrl: string): Promise<string> {
  console.log('Downloading parsing results...');
  const response = await axios.get(zipUrl, { responseType: 'arraybuffer' });

  if (response.status !== 200) {
    throw new Error(`Download failed with status: ${response.status}`);
  }

  const zipData = response.data;
  const zipFilename = path.basename(zipUrl, '.zip');
  const outputDir = path.join(process.cwd(), 'pdf_result', zipFilename);

  fs.mkdirSync(outputDir, { recursive: true });

  const zip = new AdmZip(zipData);
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
 * Main pipeline to convert PDF to HTML using MinerU
 * @param fileUrl - URL of the PDF file (must be publicly accessible)
 * @param outputPath - Optional path to save the HTML output
 * @returns HTML content
 */
export async function mineruPipeline(fileUrl: string, outputPath?: string): Promise<string> {
  console.log('\n=== Starting MinerU PDF to HTML Pipeline ===\n');
  console.log(`Input file URL: ${fileUrl}`);

  // Step 1: Submit parsing job
  const taskId = await submitParsingJob(fileUrl);

  // Step 2: Wait for result
  const resultUrl = await waitForParsingResult(taskId);

  // Step 3: Download and unzip
  const outputDir = await downloadAndUnzipResult(resultUrl);
  const fullMdPath = path.join(outputDir, 'full.md');

  // Check if markdown file exists
  if (!fs.existsSync(fullMdPath)) {
    throw new Error(`Expected markdown file not found: ${fullMdPath}`);
  }

  // Step 4: Process images and upload to MinIO
  console.log('Processing images...');
  const storageUrl = process.env.MINIO_PUBLIC_HOST || 'https://storage.treer.ai/';
  const assetPaths = processMarkdownImages(fullMdPath, storageUrl);
  const processedMdPath = path.join(outputDir, 'processed.md');

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
