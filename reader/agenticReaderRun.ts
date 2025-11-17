import * as fs from 'fs';
import * as path from 'path';
import { agenticReaderWithEvents } from './agenticReader';
import dotenv from 'dotenv';
import {run} from "node:test";
dotenv.config();

async function runAgenticReader(jsonPath) {
  console.log('='.repeat(80));
  console.log('AGENTIC READER TEST');
  console.log('='.repeat(80));

  console.log(`\nLoading document from: ${jsonPath}`);

  const data = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
  const { fullContent, chunks } = data;

  console.log(`\nDocument loaded:`);
  console.log(`  - Full content length: ${fullContent.length} characters`);
  console.log(`  - Number of chunks: ${chunks.length}`);
  console.log(`  - Chunks with summaries: ${chunks.every((c: any) => c.summary) ? 'Yes' : 'No'}`);

  // Define the question to ask
  const question = "Give a list of label\tAbsorption max (nm)\tEmission max (nm)\tLifetime (ns)\tQuantum yield  for the compounds mentioned in the document.";

  console.log(`\nQuestion: "${question}"`);
  console.log('\n' + '='.repeat(80));
  console.log('AGENTIC READER EXECUTION');
  console.log('='.repeat(80) + '\n');
  let answer = '';
  // Event handler to log all events
  const emitEvent = (event: string, data: any) => {
    console.log(`\n[EVENT: ${event.toUpperCase()}]`);
    console.log(JSON.stringify(data, null, 2));
    console.log('-'.repeat(80));
    if (event === 'answer') {
        answer = data.answer;
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

    console.log('\n' + '='.repeat(80));
    console.log('TEST COMPLETED SUCCESSFULLY');
    console.log('='.repeat(80));
  } catch (error) {
    console.error('\n' + '='.repeat(80));
    console.error('TEST FAILED');
    console.error('='.repeat(80));
    console.error('\nError:', error);
    throw error;
  }
  if (answer) {
    // save answer to a json file jsonPath.replace('.json', '_answer.json')
    const answerPath = jsonPath.replace('.json', '_answer.json');
    fs.writeFileSync(answerPath, JSON.stringify({ question, answer }, null, 2), 'utf-8');
    console.log(`\nAnswer saved to: ${answerPath}`);
  }
}


runAgenticReader("/Users/zijian/WebstormProjects/AgenticReader/dataset/10.1039:c1pp05123g.html.json")