import { tool } from 'ai';
import { z } from 'zod';
import { generateText } from 'ai';
import { openai } from '@ai-sdk/openai';

export interface AgenticReaderToolsContext {
  fullContent: string;
  emitEvent?: (event: string, data: any) => void;
  stats?: {
    tool_calls: number;
    content_reads: number;
    figure_analyses: number;
  };
}

export function createAgenticReaderTools(context: AgenticReaderToolsContext) {
  const { fullContent, emitEvent, stats } = context;

  return {
    readContent: tool({
      description: 'Read content from the document between two positions. Returns text from startPosition to endPosition. Use this to explore specific parts of the document.',
      inputSchema: z.object({
        startPosition: z.number().describe('The starting character position in the document (0-indexed, inclusive)'),
        endPosition: z.number().describe('The ending character position in the document (0-indexed, exclusive)'),
      }),
      execute: async ({ startPosition, endPosition }) => {
        if (stats) {
          stats.tool_calls++;
          stats.content_reads++;
        }

        if (emitEvent) {
          emitEvent('tool_call', {
            tool: 'readContent',
            startPosition,
            endPosition,
          });
        }

        // Validate positions
        if (startPosition < 0 || startPosition > fullContent.length) {
          return {
            success: false,
            error: `Invalid startPosition ${startPosition}. Document length is ${fullContent.length} characters.`,
          };
        }

        if (endPosition < 0 || endPosition > fullContent.length) {
          return {
            success: false,
            error: `Invalid endPosition ${endPosition}. Document length is ${fullContent.length} characters.`,
          };
        }

        if (startPosition >= endPosition) {
          return {
            success: false,
            error: `startPosition (${startPosition}) must be less than endPosition (${endPosition}).`,
          };
        }

        // Extract content
        const content = fullContent.slice(startPosition, endPosition);

        if (emitEvent) {
          emitEvent('content_read', {
            startPosition,
            endPosition,
            contentLength: content.length,
          });
        }

        return {
          success: true,
          content,
          metadata: {
            startPosition,
            endPosition,
            contentLength: content.length,
            totalDocumentLength: fullContent.length,
            hasMoreBefore: startPosition > 0,
            hasMoreAfter: endPosition < fullContent.length,
          },
        };
      },
    }),

    readFigure: tool({
      description: 'Analyze a figure/image using visual AI. Provide an image URL and a query to ask specific questions about the figure.',
      inputSchema: z.object({
        imageUrl: z.string().describe('The URL of the image to analyze'),
        query: z.string().describe('The question or analysis request for the figure (e.g., "What does this graph show?", "Describe the structure in this diagram")'),
      }),
      execute: async ({ imageUrl, query }) => {
        if (stats) {
          stats.tool_calls++;
          stats.figure_analyses++;
        }

        if (emitEvent) {
          emitEvent('tool_call', {
            tool: 'readFigure',
            imageUrl,
            query,
          });
        }

        try {
          // Use vision model to analyze the figure
          const result = await generateText({
            model: openai('gpt-5-mini'), // Use vision-capable model
            messages: [
              {
                role: 'user',
                content: [
                  {
                    type: 'text',
                    text: `Analyze this figure and answer the following query: ${query}
                    
                    Notice that the query may contain information that does not exist in the figure. In that case, you should explain what is inside the figure and try to extract related information only from the figure itself. Do not make up any information that is not present in the figure.
                    `,
                  },
                  {
                    type: 'image',
                    image: imageUrl, // Can be URL or base64
                  },
                ],
              },
            ],
          });

          if (emitEvent) {
            emitEvent('figure_analyzed', {
              imageUrl,
              query,
              result: result.text,
              analysisLength: result.text.length,
            });
          }

          return {
            success: true,
            imageUrl,
            query,
            analysis: result.text,
          };
        } catch (error) {
          console.error(`Error analyzing figure at ${imageUrl}:`, error);
          return {
            success: false,
            error: `Failed to analyze figure: ${error.message}`,
          };
        }
      },
    }),

    readTable: tool({
      description: 'Extract and convert a table from an image into HTML format. Provide an image URL containing a table.',
      inputSchema: z.object({
        imageUrl: z.string().describe('The URL of the image containing the table to extract'),
      }),
      execute: async ({ imageUrl }) => {
        if (stats) {
          stats.tool_calls++;
        }

        if (emitEvent) {
          emitEvent('tool_call', {
            tool: 'readTable',
            imageUrl,
          });
        }

        try {
          // Use vision model to extract table data
          const result = await generateText({
            model: openai('gpt-5-mini'), // Use vision-capable model
            messages: [
              {
                role: 'user',
                content: [
                  {
                    type: 'text',
                    text: `Extract the table from this image and convert it to HTML format.

                    Requirements:
                    - Return ONLY the HTML table code (starting with <table> and ending with </table>)
                    - Preserve the table structure, including headers, rows, and columns
                    - Maintain the data accuracy from the original table
                    - Use proper HTML table tags: <table>, <thead>, <tbody>, <tr>, <th>, <td>
                    - Do not include any additional text, explanations, or markdown formatting
                    - If the image does not contain a table, respond with an error message`,
                  },
                  {
                    type: 'image',
                    image: imageUrl,
                  },
                ],
              },
            ],
          });

          if (emitEvent) {
            emitEvent('table_extracted', {
              imageUrl,
              htmlLength: result.text.length,
            });
          }

          return {
            success: true,
            imageUrl,
            tableHtml: result.text,
          };
        } catch (error) {
          console.error(`Error extracting table from ${imageUrl}:`, error);
          return {
            success: false,
            error: `Failed to extract table: ${error.message}`,
          };
        }
      },
    }),

    searchContent: tool({
      description: 'Search for specific text in the document. Returns the positions where the text is found.',
      inputSchema: z.object({
        searchText: z.string().describe('Text to search for in the document'),
        maxResults: z.number().optional().describe('Maximum number of results to return (default: 5)'),
      }),
      execute: async ({ searchText, maxResults = 5 }) => {
        if (stats) {
          stats.tool_calls++;
        }

        if (emitEvent) {
          emitEvent('tool_call', {
            tool: 'searchContent',
            searchText,
            maxResults,
          });
        }

        const results: Array<{ position: number; context: string }> = [];
        const searchLower = searchText.toLowerCase();

        let currentPos = 0;
        while (results.length < maxResults && currentPos < fullContent.length) {
          const foundPos = fullContent.toLowerCase().indexOf(searchLower, currentPos);

          if (foundPos === -1) break;

          // Get context around the found position
          const contextStart = Math.max(0, foundPos - 50);
          const contextEnd = Math.min(fullContent.length, foundPos + searchText.length + 50);
          const context = fullContent.slice(contextStart, contextEnd);

          results.push({
            position: foundPos,
            context: `...${context}...`,
          });

          currentPos = foundPos + searchText.length;
        }

        if (emitEvent) {
          emitEvent('search_complete', {
            searchText,
            resultsFound: results.length,
          });
        }

        return {
          success: true,
          searchText,
          resultsFound: results.length,
          results,
          hasMore: currentPos < fullContent.length && fullContent.toLowerCase().indexOf(searchLower, currentPos) !== -1,
        };
      },
    }),
  };
}
