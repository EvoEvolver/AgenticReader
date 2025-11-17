import TurndownService from 'turndown';
import { generateText } from 'ai';
import { openai } from '@ai-sdk/openai';

export interface MarkdownChunk {
  content: string;
  chunkIndex: number;
  startChar: number;
  endChar: number;
  totalChunks: number;
}

export interface MarkdownChunkWithSummary extends MarkdownChunk {
  summary: string;
}

/**
 * Converts HTML to Markdown and chunks it with overlap
 * @param html - The HTML content to convert
 * @param chunkSize - Size of each chunk in characters (default: 5000)
 * @param overlap - Number of overlapping characters between chunks (default: 1000)
 * @returns Array of markdown chunks with metadata
 */
export function htmlToMarkdownChunks(
  html: string,
  chunkSize: number = 5000,
  overlap: number = 1000
): MarkdownChunk[] {
  // Initialize Turndown service
  const turndownService = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
    bulletListMarker: '-',
  });

  // Remove style and script tags
  turndownService.remove(['style', 'script']);

  // Convert HTML to Markdown
  const markdown = turndownService.turndown(html);

  // If markdown is shorter than chunk size, return single chunk
  if (markdown.length <= chunkSize) {
    return [
      {
        content: markdown,
        chunkIndex: 0,
        startChar: 0,
        endChar: markdown.length,
        totalChunks: 1,
      },
    ];
  }

  // Calculate step size (chunk size minus overlap)
  const stepSize = chunkSize - overlap;
  const chunks: MarkdownChunk[] = [];

  // Create chunks with overlap
  for (let i = 0; i < markdown.length; i += stepSize) {
    const startChar = i;
    const endChar = Math.min(i + chunkSize, markdown.length);
    const content = markdown.slice(startChar, endChar);

    chunks.push({
      content,
      chunkIndex: chunks.length,
      startChar,
      endChar,
      totalChunks: 0, // Will be set after we know total count
    });

    // Stop if we've reached the end
    if (endChar >= markdown.length) {
      break;
    }
  }

  // Update total chunks count
  const totalChunks = chunks.length;
  chunks.forEach(chunk => {
    chunk.totalChunks = totalChunks;
  });

  return chunks;
}

/**
 * Converts HTML to Markdown without chunking
 * @param html - The HTML content to convert
 * @returns Markdown string
 */
export function htmlToMarkdown(html: string): string {
  const turndownService = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
    bulletListMarker: '-',
  });

  // Remove style and script tags
  turndownService.remove(['style', 'script']);

  return turndownService.turndown(html);
}

/**
 * Generates summaries for markdown chunks using AI with parallel processing
 * @param chunks - Array of markdown chunks to summarize
 * @param fullContent - The complete original markdown content
 * @param modelName - OpenAI model to use (default: 'gpt-5-mini')
 * @param maxConcurrency - Maximum number of parallel workers (default: 10)
 * @returns Array of chunks with generated summaries
 */
export async function generateChunkSummaries(
  chunks: MarkdownChunk[],
  fullContent: string,
  modelName: string = 'gpt-5-mini',
  maxConcurrency: number = 10
): Promise<MarkdownChunkWithSummary[]> {
  const results: MarkdownChunkWithSummary[] = new Array(chunks.length);
  let completed = 0;

  console.log(`Starting summarization of ${chunks.length} chunks with ${maxConcurrency} workers...`);

  const generateSummary = async (chunk: MarkdownChunk, index: number) => {
    const prompt = `Summarize the following markdown content in 50 words. Focus on the main topics and key information. Pay special attention to and prioritize summarizing any figures, tables, charts, or data visualizations - describe what they show and their key findings:

${chunk.content}`;

    const { text } = await generateText({
      model: openai(modelName),
      prompt,
    });

    results[index] = {
      ...chunk,
      summary: text,
    };

    completed++;
    console.log(`Progress: ${completed}/${chunks.length} chunks summarized (${Math.round((completed / chunks.length) * 100)}%)`);
  };

  // Process chunks in batches with max concurrency
  const queue = chunks.map((chunk, index) => ({ chunk, index }));
  const workers: Promise<void>[] = [];

  for (let i = 0; i < Math.min(maxConcurrency, chunks.length); i++) {
    const worker = (async () => {
      while (queue.length > 0) {
        const item = queue.shift();
        if (item) {
          await generateSummary(item.chunk, item.index);
        }
      }
    })();
    workers.push(worker);
  }

  await Promise.all(workers);
  console.log('✓ All chunks summarized successfully!');

  return results;
}

/**
 * Converts HTML to markdown chunks with AI-generated summaries
 * @param html - The HTML content to convert
 * @param chunkSize - Size of each chunk in characters (default: 5000)
 * @param overlap - Number of overlapping characters between chunks (default: 1000)
 * @param modelName - OpenAI model to use for summaries (default: 'gpt-5-mini')
 * @param maxConcurrency - Maximum number of parallel workers (default: 10)
 * @returns Array of chunks with summaries and full content
 */
export async function htmlToMarkdownChunksWithSummaries(
  html: string,
  chunkSize: number = 5000,
  overlap: number = 1000,
  modelName: string = 'gpt-5-mini',
  maxConcurrency: number = 10
) {
  // Convert HTML to markdown first
  const fullMarkdown = htmlToMarkdown(html);

  // Create chunks from the markdown
  const chunks = htmlToMarkdownChunks(html, chunkSize, overlap);

  // Generate summaries with the full content included
  const chunksWithSummary = await generateChunkSummaries(chunks, fullMarkdown, modelName, maxConcurrency);

  return {
    fullContent: fullMarkdown,
    chunks: chunksWithSummary,
  }
}
