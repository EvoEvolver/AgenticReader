import { generateText, stepCountIs } from 'ai';
import { openai } from '@ai-sdk/openai';
import { createAgenticReaderTools } from './agenticReaderTools';

export interface AgenticReaderOptions {
  max_iterations?: number;
  model?: string;
  include_metadata?: boolean;
}

export interface AgenticReaderResult {
  answer: string;
  metadata?: {
    processing_time_ms: number;
    stats: {
      tool_calls: number;
      content_reads: number;
      figure_analyses: number;
      search_iterations: number;
    };
  };
}

/**
 * Agentic reader with event streaming for real-time progress updates
 * @param question - The question to answer about the document
 * @param fullContent - The complete markdown content of the document
 * @param emitEvent - Callback function to emit events
 * @param options - Configuration options
 */
export async function agenticReaderWithEvents(
  question: string,
  fullContent: string,
  chunksWithSummaries: any[],
  emitEvent: (event: string, data: any) => void,
  options: AgenticReaderOptions = {}
): Promise<void> {
  const startTime = Date.now();
  const stats = {
    tool_calls: 0,
    content_reads: 0,
    figure_analyses: 0,
    search_iterations: 0,
  };

  const {
    max_iterations,
    model = 'gpt-5-mini',
    include_metadata = false,
  } = options;

  try {
    emitEvent('status', {
      stage: 'starting',
      message: 'Initializing agentic reader...',
    });

    emitEvent('status', {
      stage: 'document_loaded',
      message: `Document loaded: ${fullContent.length} characters`,
      documentLength: fullContent.length,
    });

    // Create tools for the agent
    const tools = createAgenticReaderTools({
      fullContent,
      stats,
      emitEvent,
    });

    // Format chunks with summaries for the prompt
    const chunksPreview = chunksWithSummaries
      .map((chunk, idx) => {
        return `Chunk ${idx + 1}/${chunksWithSummaries.length} (chars ${chunk.startChar}-${chunk.endChar}):
Summary: ${chunk.summary}`;
      })
      .join('\n\n');

    // Create the system prompt
    const systemPrompt = `You are an intelligent document reading agent designed to answer questions by exploring a document strategically.

QUESTION TO ANSWER: "${question}"

YOUR TASK:
Explore the document intelligently to find information that answers the user's question. You have the following tools:

- **readContent**: Read content at a specific position (returns -100 to +500 characters around the position)
- **readTable**: Convert table into html by the url of its image
- **readFigure**: Analyze figures  using visual AI by providing an image URL and query
- **searchContent**: Search the position of a specific text in the document

STRATEGY:
- Use readContent to explore promising chunks in whole
- If you find image URLs in the content and need to analyze them, use readFigure with the URL

DOCUMENT CHUNKS AND SUMMARIES:
Below are summaries of different sections of the document to help you navigate. You should use readContent to read the full content of the most relevant chunks based on these summaries.

${chunksPreview}

When you're ready to provide the final answer, include it in your last response with clear explanations and citations.`;

    emitEvent('status', {
      stage: 'exploring',
      message: 'Agent is exploring the document...',
    });

    // Run the agent
    const result = await generateText({
      model: openai(model),
      tools,
      system: systemPrompt,
      prompt: `Begin exploring the document to answer the question: "${question}". Start by getting document info and searching for relevant content.`,
      stopWhen: stepCountIs(max_iterations),
      prepareStep: async ({ messages }) => {
        // Keep only recent messages to stay within context limits
        if (messages.length > 20) {
          return {
            messages: [
              messages[0], // Keep system message
              ...messages.slice(-20), // Keep last 10 messages
            ],
          };
        }
        return {};
      },
    });

    stats.search_iterations = result.steps.length;

    emitEvent('status', {
      stage: 'exploration_complete',
      message: `Agent completed exploration in ${result.steps.length} steps`,
      stats,
    });

    emitEvent('answer', {
      answer: result.text,
    });

    if (include_metadata) {
      emitEvent('metadata', {
        processing_time_ms: Date.now() - startTime,
        stats,
      });
    }

    emitEvent('complete', {
      message: 'Agentic reading completed successfully',
    });
  } catch (error) {
    console.error('[AgenticReaderWithEvents] Error during agentic reading:', error);
    emitEvent('error', {
      message: error.message || 'An error occurred during reading',
    });
  }
}
